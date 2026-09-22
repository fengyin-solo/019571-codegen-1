/* 存储层逻辑验证：模拟 localStorage，覆盖正常读写、空间不足保留原方案、键隔离 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..', 'frontend-user', 'js');

// --- 最小化 CONFIG（storage.js 依赖 CONFIG.STORAGE_KEYS） ---
const CONFIG = {
    STORAGE_KEYS: {
        DESIGNS: 'optics_designs',
        SETTINGS: 'optics_settings',
        GUIDE_COMPLETED: 'optics_guide_completed',
        CURRENT_DESIGN: 'optics_current_design'
    }
};

// --- 可切换故障模式的 localStorage mock（始终是同一个对象） ---
const memory = {
    map: new Map(),
    failOnSet: null,
    reset(failOnSet = null, prefill = {}) {
        this.map = new Map(Object.entries(prefill));
        this.failOnSet = failOnSet;
    },
    getItem(k) { return this.map.has(k) ? this.map.get(k) : null; },
    setItem(k, v) {
        if (this.failOnSet && this.failOnSet(k, v)) {
            const err = new Error('QuotaExceededError');
            err.name = 'QuotaExceededError';
            err.code = 22;
            throw err;
        }
        this.map.set(k, String(v));
    },
    removeItem(k) { this.map.delete(k); }
};

const sandbox = {
    CONFIG,
    console,
    localStorage: memory
};
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(root, 'storage.js'), 'utf8'), sandbox);
const Storage = vm.runInContext('Storage', sandbox);

let passed = 0, failed = 0;
function assert(cond, msg) {
    if (cond) { passed++; console.log('  ✓', msg); }
    else { failed++; console.log('  ✗', msg); }
}

// 1. 初始为空
memory.reset();
assert(Storage.getDesigns().ok && Storage.getDesigns().designs.length === 0, '空存储读取返回空数组');
assert(Storage.getCurrentDesignId() === null, '当前选中 ID 初始为 null');

// 2. 引导状态独立
Storage.setGuideCompleted();
assert(Storage.isGuideCompleted() === true, '引导完成状态可写入');
assert(Storage.getDesigns().designs.length === 0, '写引导键不影响设计方案列表');

// 3. 写入 + 读回
const d1 = { id: 'a', name: '方案A', createdAt: 1, updatedAt: 1, lenses: [{ id: 'l1' }], light: {} };
const d2 = { id: 'b', name: '方案B', createdAt: 2, updatedAt: 2, lenses: [], light: {} };
assert(Storage.saveDesigns([d1]).ok, '首次保存成功');
assert(Storage.setCurrentDesignId('a').ok, '记录当前方案 ID 成功');
let got = Storage.getDesigns();
assert(got.ok && got.designs.length === 1 && got.designs[0].id === 'a', '读回 1 个方案');
assert(Storage.getCurrentDesignId() === 'a', '读回当前方案 ID = a');

// 4. 空间不足：写入失败但原方案保留（保留同一 localStorage 对象，只切换故障开关）
memory.reset((k) => k === 'optics_designs', {
    optics_designs: JSON.stringify({ version: 1, designs: [d1] }),
    optics_current_design: 'a'
});
assert(Storage.saveDesigns([d1, d2]).error === 'quota', '空间不足返回 quota 错误');
got = Storage.getDesigns();
assert(got.designs.length === 1 && got.designs[0].id === 'a', '失败后原方案（方案A）完整保留');
assert(Storage.getCurrentDesignId() === 'a', '失败后当前选中 ID 未被篡改');

// 5. 故障恢复后重试成功
let failNext = true;
memory.reset(() => {
    if (failNext) { failNext = false; const e = new Error('q'); e.name = 'QuotaExceededError'; e.code = 22; throw e; }
    return false;
}, { optics_designs: JSON.stringify({ version: 1, designs: [d1] }) });
assert(Storage.saveDesigns([d1, d2]).error === 'quota', '第一次写入报空间不足');
assert(Storage.saveDesigns([d1, d2]).ok && Storage.getDesigns().designs.length === 2, '重试写入成功，得到 2 个方案');

// 6. 重置引导不碰方案键
Storage.setCurrentDesignId('a');
Storage.setGuideCompleted();
Storage.resetGuide();
assert(Storage.isGuideCompleted() === false, '重置引导后引导状态清除');
assert(Storage.getDesigns().designs.length === 2, '重置引导不影响设计方案');
assert(Storage.getCurrentDesignId() === 'a', '重置引导不影响当前选中方案');

// 7. 损坏数据返回错误而不是静默覆盖
memory.reset(null, { optics_designs: '{not-json' });
assert(Storage.getDesigns().ok === false, '损坏 JSON 报告读取失败');
memory.reset(null, { optics_designs: JSON.stringify({ wrong: 1 }) });
assert(Storage.getDesigns().ok === false, '结构错误报告读取失败');

// 8. 兼容旧版裸数组格式
memory.reset(null, { optics_designs: JSON.stringify([d1]) });
got = Storage.getDesigns();
assert(got.ok && got.designs.length === 1, '兼容历史裸数组格式');

// 9. setCurrentDesignId(null) 清除选中
assert(Storage.setCurrentDesignId(null).ok && Storage.getCurrentDesignId() === null, '可清除当前选中 ID');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
