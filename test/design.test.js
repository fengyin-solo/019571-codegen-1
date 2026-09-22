/* DesignManager 集成验证：mock DOM/画布/渲染器，走通保存→刷新恢复→复制→删除→失败重试 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'frontend-user', 'js');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

let passed = 0, failed = 0;
function assert(cond, msg) {
    if (cond) { passed++; console.log('  ✓', msg); }
    else { failed++; console.log('  ✗', msg); }
}

/** 模拟事件委托：让列表项内按钮的 closest() 指向所属列表项 */
function wireClosest(item) {
    item.children[1].children.forEach(btn => {
        btn.parentNode = item.children[1];
        btn.closest = (sel) => sel === '.design-item' ? item : btn;
    });
    item.children[1].parentNode = item;
    item.parentNode = null; // 列表项在真实 DOM 中由列表容器持有
}

// ---------- 最小 DOM mock ----------
function fakeEl(tag = 'div') {
    const el = {
        tag, children: [], dataset: {}, style: {},
        classList: {
            _set: new Set(),
            add(...cs) { cs.forEach(c => this._set.add(c)); },
            remove(...cs) { cs.forEach(c => this._set.delete(c)); },
            toggle(c, f) { if (f === undefined) f = !this._set.has(c); f ? this.add(c) : this.remove(c); },
            contains(c) { return this._set.has(c); }
        },
        handlers: {},
        addEventListener(type, fn) { (this.handlers[type] = this.handlers[type] || []).push(fn); },
        dispatch(type, event = {}) {
            const ev = Object.assign({ target: this, type }, event);
            (this.handlers[type] || []).forEach(fn => fn(ev));
        },
        appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
        remove() {
            if (this.parentNode) {
                const arr = this.parentNode.children;
                const i = arr.indexOf(this);
                if (i > -1) arr.splice(i, 1);
                this.parentNode = null;
            }
        },
        querySelector(sel) {
            if (sel === 'span') {
                if (!this._span) this._span = fakeEl('span');
                return this._span;
            }
            return null;
        },
        querySelectorAll(sel) {
            if (sel === '.design-item') return this.children.filter(c => c.classList.contains('design-item'));
            return [];
        },
        get isConnected() { return !!this.parentNode; },
        _text: '',
        get textContent() { return this._text; },
        set textContent(v) {
            this._text = String(v);
            // 简化：设计管理器只对叶子节点设置文本，不影响 children 结构
        },
        _value: '',
        get value() { return this._value; },
        set value(v) { this._value = String(v); },
        disabled: false,
        placeholder: '',
        innerHTML: '',
        closest() { return null; }
    };
    Object.defineProperty(el, 'className', {
        get() { return Array.from(el.classList._set).join(' '); },
        set(v) {
            el.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
        }
    });
    return el;
}

function makeStore() {
    const map = new Map();
    return {
        failNextDesignWrite: false,
        getItem: k => map.has(k) ? map.get(k) : null,
        setItem(k, v) {
            if (k === 'optics_designs' && this.failNextDesignWrite) {
                this.failNextDesignWrite = false;
                const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; e.code = 22;
                throw e;
            }
            map.set(k, String(v));
        },
        removeItem: k => { map.delete(k); },
        _raw: k => map.get(k)
    };
}

function buildHarness() {
    const store = makeStore();
    const elements = new Map();
    const getEl = id => {
        if (!elements.has(id)) elements.set(id, fakeEl());
        return elements.get(id);
    };

    const sandbox = {
        console,
        localStorage: store,
        setTimeout: (fn) => { /* 不执行删除确认倒计时 */ return 0; },
        clearTimeout: () => {},
        Date,
        Math,
        JSON,
        Object,
        Array,
        isFinite,
        document: {
            readyState: 'complete',
            getElementById: getEl,
            createElement: tag => fakeEl(tag),
            addEventListener: () => {}
        },
        CustomEvent: class CustomEvent {
            constructor(type, init = {}) { this.type = type; this.detail = init.detail; }
        }
    };
    sandbox.window = sandbox;
    sandbox.window.addEventListener = () => {};
    sandbox.window.dispatchEvent = () => {};
    vm.createContext(sandbox);

    ['config.js', 'utils.js', 'storage.js', 'physics.js', 'lens.js', 'design.js'].forEach(f =>
        vm.runInContext(read(f), sandbox));

    // 真实 Lens 类
    const Lens = vm.runInContext('Lens', sandbox);

    // 画布 / 渲染器 / 交互 mock
    const replaced = { calls: [] };
    const renderer = {
        lightMode: 'parallel', rayCount: 5, incidentAngle: 0,
        isRunning: false, showLabels: true, showDispersion: false,
        width: 800, height: 600,
        setStateCalls: [],
        // 接收 DesignManager.applyDesign 映射后的字段（与真实 Renderer.setState 一致）
        setState(s) { this.setStateCalls.push(s); Object.assign(this, s); }
    };
    const canvasManager = {
        lenses: [],
        suppressChanges: false,
        getRenderer: () => renderer,
        replaceLenses(lenses) { replaced.calls.push(lenses); canvasManager.lenses = lenses; }
    };
    const interactionManager = { syncCalls: 0, syncLightUI() { this.syncCalls++; } };

    const DesignManager = vm.runInContext('DesignManager', sandbox);

    // 与真实 HTML 初始状态保持一致：列表隐藏（空态时显示）、模态框隐藏
    getEl('design-list').classList.add('hidden');
    getEl('design-modal').classList.add('hidden');
    // 更新按钮含 <span> 且默认 disabled
    getEl('btn-design-update').appendChild(fakeEl('span'));
    getEl('btn-design-update').disabled = true;

    return {
        store, getEl, Lens, renderer, canvasManager, interactionManager,
        replaced, create: () => new DesignManager(canvasManager, interactionManager)
    };
}

// ---------- 场景 ----------

// 1. 空态
{
    const h = buildHarness();
    const dm = h.create();
    const list = h.getEl('design-list'), empty = h.getEl('design-empty');
    assert(list.classList.contains('hidden'), '空存储：列表隐藏');
    assert(!empty.classList.contains('hidden'), '空存储：显示空态说明');
    assert(h.getEl('btn-design-update').disabled, '空存储：更新按钮禁用');
    assert(dm.currentId === null, '空存储：无当前选中方案');
}

// 2. 保存新方案（透镜带自定义折射率）
{
    const h = buildHarness();
    const dm = h.create();
    const lens = new h.Lens({ type: 'convex', x: 300, y: 250, material: 'highIndex' });
    lens.refractiveIndex = 1.77;
    lens.size = 120; lens.curvature = 70;
    h.canvasManager.lenses = [lens];
    h.renderer.lightMode = 'point';
    h.renderer.isRunning = true;

    h.getEl('design-name-input').value = '我的望远镜';
    h.getEl('btn-design-save').dispatch('click');

    const stored = JSON.parse(h.store._raw('optics_designs'));
    assert(stored.designs.length === 1, '保存：写入 1 个方案');
    assert(stored.designs[0].name === '我的望远镜', '保存：名称正确');
    assert(stored.designs[0].lenses[0].refractiveIndex === 1.77, '保存：自定义折射率 1.77 已序列化');
    assert(stored.designs[0].light.mode === 'point' && stored.designs[0].light.isRunning === true, '保存：光源模式与运行状态已序列化');
    assert(h.store.getItem('optics_current_design') === stored.designs[0].id, '保存：当前选中 ID 已记录');
    assert(dm.dirty === false, '保存后：未标记为已修改');
}

// 3. 刷新后恢复（折射率保真 bug 回归）
{
    const h = buildHarness();
    const lens = new h.Lens({ type: 'aspheric', x: 400, y: 300, material: 'lowDispersion' });
    lens.refractiveIndex = 1.61;
    h.canvasManager.lenses = [lens];
    h.renderer.lightMode = 'point';
    h.renderer.isRunning = true;
    h.getEl('design-name-input').value = '方案X';
    const dm1 = h.create();
    h.getEl('btn-design-save').dispatch('click');
    const savedId = JSON.parse(h.store._raw('optics_designs')).designs[0].id;

    // 模拟刷新：新的 DesignManager 实例、画布清空、渲染器重置为默认
    h.canvasManager.lenses = [];
    h.renderer.lightMode = 'parallel'; h.renderer.isRunning = false;
    const dm2 = h.create();

    assert(h.replaced.calls.length === 1, '刷新：自动调用 replaceLenses 恢复画布');
    const restored = h.replaced.calls[0];
    assert(restored.length === 1, '刷新：恢复 1 个透镜');
    assert(restored[0].refractiveIndex === 1.61, '刷新：折射率 1.61 完整恢复（不被材料默认值覆盖）');
    assert(restored[0].type === 'aspheric' && restored[0].material === 'lowDispersion', '刷新：类型与材料恢复');
    assert(h.renderer.lightMode === 'point' && h.renderer.isRunning === true, '刷新：光源模式与运行状态恢复');
    assert(dm2.currentId === savedId, '刷新：当前选中方案保持一致');
    assert(h.interactionManager.syncCalls >= 1, '刷新：同步了光源控件 UI');
}

// 4. 复制方案
{
    const h = buildHarness();
    const dm = h.create();
    h.canvasManager.lenses = [new h.Lens({ x: 100, y: 100 })];
    h.getEl('design-name-input').value = '原始';
    h.getEl('btn-design-save').dispatch('click');
    const originalId = dm.currentId;

    // 打开列表，找到复制按钮并点击
    dm.openModal();
    const list = h.getEl('design-list');
    const item = list.children[0];
    item.parentNode = list;
    wireClosest(item);
    const dupBtn = item.children[1].children.find(b => b.dataset.action === 'duplicate');
    // 模拟真实 DOM 的事件冒泡：事件目标是按钮，监听器在列表容器上
    list.dispatch('click', { target: dupBtn });

    const dupRaw = h.store._raw('optics_designs');
    const stored = JSON.parse(dupRaw).designs;
    assert(stored.length === 2, '复制：列表变为 2 个方案');
    assert(stored.find(d => d.name === '原始 副本'), '复制：副本命名为「原始 副本」');
    assert(dm.currentId !== originalId, '复制：自动切换到副本');
    assert(stored.find(d => d.id === dm.currentId).lenses[0].id !== stored.find(d => d.id === originalId).lenses[0].id,
        '复制：副本中的透镜获得新 ID');
}

// 5. 删除：两步确认；删除当前方案后解除归属
{
    const h = buildHarness();
    const dm = h.create();
    h.canvasManager.lenses = [new h.Lens({ x: 1, y: 1 })];
    h.getEl('design-name-input').value = '待删';
    h.getEl('btn-design-save').dispatch('click');

    dm.openModal();
    const delList = h.getEl('design-list');
    const item = delList.children[0];
    item.parentNode = delList;
    wireClosest(item);
    const delBtn = item.children[1].children.find(b => b.dataset.action === 'delete');

    delList.dispatch('click', { target: delBtn });
    assert(delBtn.dataset.confirming === '1', '删除：第一次点击进入确认态');
    assert(JSON.parse(h.store._raw('optics_designs')).designs.length === 1, '删除：确认前数据未动');

    delList.dispatch('click', { target: delBtn });
    assert(JSON.parse(h.store._raw('optics_designs')).designs.length === 0, '删除：第二次点击后删除');
    assert(dm.currentId === null, '删除当前方案：归属解除');
    assert(h.store.getItem('optics_current_design') === null, '删除当前方案：当前选中键已清除');
    assert(!h.getEl('design-empty').classList.contains('hidden'), '删除到空：重新显示空态');
}

// 6. 写入失败保留原方案，重试成功
{
    const h = buildHarness();
    const dm = h.create();
    h.canvasManager.lenses = [new h.Lens({ x: 1, y: 1 })];
    h.getEl('design-name-input').value = '方案一';
    h.getEl('btn-design-save').dispatch('click');

    // 下一次写入失败
    h.store.failNextDesignWrite = true;
    h.canvasManager.lenses.push(new h.Lens({ x: 2, y: 2 }));
    h.getEl('design-name-input').value = '方案二';
    h.getEl('btn-design-save').dispatch('click');

    assert(!h.getEl('design-error').classList.contains('hidden'), '空间不足：显示错误提示条');
    assert(h.getEl('design-error-text').textContent.includes('空间不足'), '错误文案提示空间不足并可重试');
    assert(JSON.parse(h.store._raw('optics_designs')).designs.length === 1, '空间不足：原方案保留');
    assert(dm.designs.length === 1, '空间不足：内存中的方案未被污染');

    // 点击重试
    h.getEl('design-error-retry').dispatch('click');
    assert(h.getEl('design-error').classList.contains('hidden'), '重试成功：错误条消失');
    assert(JSON.parse(h.store._raw('optics_designs')).designs.length === 2, '重试成功：方案二已写入');
}

// 7. 修改画布 → 已修改标记 → 更新当前方案
{
    const h = buildHarness();
    const dm = h.create();
    h.canvasManager.lenses = [new h.Lens({ x: 1, y: 1 })];
    h.getEl('design-name-input').value = '初版';
    h.getEl('btn-design-save').dispatch('click');

    // 模拟画布改动事件
    const windowHandlers = [];
    // DesignManager 在 init 中通过 window.addEventListener 订阅，sandbox 里是空函数；
    // 直接调用 markDirty 验证逻辑等价路径
    dm.markDirty();
    assert(dm.dirty === true, '画布改动：当前方案标记为已修改');

    dm.openModal();
    const badgeEl = h.getEl('design-list').children[0].children[0].children[0].children[1];
    assert(badgeEl.textContent === '已修改', '列表中显示「已修改」徽标');

    h.getEl('btn-design-update').dispatch('click');
    const stored = JSON.parse(h.store._raw('optics_designs')).designs[0];
    assert(stored.name === '初版', '更新：未改名时保留原名称');
    assert(dm.dirty === false, '更新后：已修改标记清除');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
