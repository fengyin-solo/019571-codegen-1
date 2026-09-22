/**
 * 设计方案管理器
 *
 * 把画布上的透镜组合、光源模式与可调参数整体保存为命名方案，
 * 支持随时切换、复制另存、删除；刷新页面后自动恢复上次选中的方案。
 *
 * 存储职责与 Storage 中一一对应，与引导状态键完全隔离。
 */
class DesignManager {
    constructor(canvasManager, interactionManager) {
        this.canvasManager = canvasManager;
        this.interactionManager = interactionManager;
        this.renderer = canvasManager.getRenderer();

        this.designs = [];
        this.currentId = null;   // 当前画布对应的已保存方案 ID
        this.dirty = false;      // 当前方案载入后是否被改动过
        this.readError = false;  // 本地数据无法读取时禁止覆盖写入

        // 最近一次写入失败的现场，供“重试”按钮使用
        this.pendingCommit = null;

        this.modal = document.getElementById('design-modal');
        this.nameInput = document.getElementById('design-name-input');
        this.saveBtn = document.getElementById('btn-design-save');
        this.updateBtn = document.getElementById('btn-design-update');
        this.listEl = document.getElementById('design-list');
        this.emptyEl = document.getElementById('design-empty');
        this.errorEl = document.getElementById('design-error');
        this.errorTextEl = document.getElementById('design-error-text');

        this.init();
    }

    /**
     * 初始化：读取本地方案、恢复当前选中方案、绑定界面事件
     */
    init() {
        const result = Storage.getDesigns();
        if (result.ok) {
            this.designs = this.normalizeDesigns(result.designs);
        } else {
            // 读取失败时不主动覆盖，提示用户后再决定
            this.designs = [];
            this.readError = true;
            Utils.showToast('本地方案读取失败，暂时无法保存，请刷新重试', 'warning', 3500);
        }

        this.currentId = Storage.getCurrentDesignId();

        // 刷新后恢复上次选中的方案
        const current = this.getDesign(this.currentId);
        if (current) {
            this.applyDesign(current, { silent: true });
        } else {
            // 记录的方案已不存在，清掉无效的选中标记
            this.currentId = null;
            Storage.setCurrentDesignId(null);
        }
        this.dirty = false;

        this.bindEvents();
    }

    /**
     * 绑定界面事件
     */
    bindEvents() {
        // 顶部工具栏入口
        const openBtn = document.getElementById('btn-designs');
        if (openBtn) {
            openBtn.addEventListener('click', () => this.openModal());
        }

        // 模态框按钮
        document.getElementById('btn-design-close').addEventListener('click', () => this.closeModal());
        document.getElementById('btn-design-cancel').addEventListener('click', () => this.closeModal());
        this.saveBtn.addEventListener('click', () => this.handleSaveNew());
        this.updateBtn.addEventListener('click', () => this.handleUpdateCurrent());
        document.getElementById('design-error-retry').addEventListener('click', () => this.retryCommit());

        // 点击遮罩或按 Esc 关闭
        this.modal.addEventListener('click', (e) => {
            if (e.target === this.modal) this.closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && !this.modal.classList.contains('hidden')) {
                this.closeModal();
            }
        });

        // 方案列表内的切换 / 复制 / 删除（事件委托）
        this.listEl.addEventListener('click', (e) => {
            const item = e.target.closest('.design-item');
            if (!item) return;
            const id = item.dataset.id;

            const actionEl = e.target.closest('[data-action]');
            if (!actionEl) return;
            const action = actionEl.dataset.action;

            if (action === 'apply') this.handleApply(id);
            if (action === 'duplicate') this.handleDuplicate(id);
            if (action === 'delete') this.handleDeleteRequest(id, actionEl);
        });

        // 画布有任何改动，标记当前方案为“已修改”
        window.addEventListener('canvasChanged', () => this.markDirty());
    }

    /* ------------------------------------------------------------------ */
    /* 方案数据的序列化 / 恢复                                              */
    /* ------------------------------------------------------------------ */

    /**
     * 把当前画布状态序列化为可存储的方案数据
     */
    serializeCurrent(name) {
        return {
            id: Utils.generateId(),
            name: name,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lenses: this.canvasManager.lenses.map(lens => lens.toJSON()),
            light: {
                mode: this.renderer.lightMode,
                rayCount: this.renderer.rayCount,
                incidentAngle: this.renderer.incidentAngle,
                isRunning: this.renderer.isRunning,
                showLabels: this.renderer.showLabels,
                showDispersion: this.renderer.showDispersion
            }
        };
    }

    /**
     * 恢复一份方案到画布
     * @param {Object} design 方案数据
     * @param {Object} options silent: 不弹提示、不写当前选中（初始化时使用）
     */
    applyDesign(design, options = {}) {
        const lenses = (design.lenses || []).map(data => Lens.fromJSON(data));

        // 抑制重建过程中的 canvasChanged，避免把“载入方案”误判成用户修改
        this.canvasManager.suppressChanges = true;
        try {
            this.canvasManager.replaceLenses(lenses);
            const light = design.light || {};
            this.renderer.setState({
                lightMode: light.mode,
                rayCount: light.rayCount,
                incidentAngle: light.incidentAngle,
                isRunning: light.isRunning,
                showLabels: light.showLabels,
                showDispersion: light.showDispersion
            });
        } finally {
            this.canvasManager.suppressChanges = false;
        }

        // 同步光源下拉框、按钮等控件状态，并关闭参数面板
        this.interactionManager.syncLightUI();
        window.dispatchEvent(new CustomEvent('lensDeselected'));

        this.currentId = design.id;
        this.dirty = false;

        if (!options.silent && !options.skipPersist) {
            const r = Storage.setCurrentDesignId(design.id);
            if (!r.ok) {
                // 方案列表已是最新，仅当前选中标记没写进去：提示重试
                this.pendingCommit = {
                    designs: null, currentId: design.id, onSuccess: null, idOnly: true
                };
                this.showWriteError(r.error);
            }
            Utils.showToast(`已切换到方案「${design.name}」`, 'success');
            this.closeModal();
        }
    }

    /* ------------------------------------------------------------------ */
    /* 保存 / 更新 / 复制 / 删除                                           */
    /* ------------------------------------------------------------------ */

    /**
     * 保存为新方案
     */
    handleSaveNew() {
        if (this.readError) {
            this.showWriteError('read');
            return;
        }

        const name = this.readName() || this.defaultName();
        const design = this.serializeCurrent(name);

        const next = this.designs.concat([design]);
        this.commit(next, design.id, () => {
            Utils.showToast(`方案「${name}」已保存`, 'success');
            this.nameInput.value = '';
            this.renderList();
            this.updateSaveSection();
        });
    }

    /**
     * 更新当前方案（覆盖原方案内容，保留创建时间）
     */
    handleUpdateCurrent() {
        const current = this.getDesign(this.currentId);
        if (!current) return;

        const name = this.readName() || current.name;
        const snapshot = this.serializeCurrent(name);
        const updated = Object.assign({}, current, {
            name: name,
            updatedAt: Date.now(),
            lenses: snapshot.lenses,
            light: snapshot.light
        });

        const next = this.designs.map(d => d.id === current.id ? updated : d);
        this.commit(next, current.id, () => {
            this.dirty = false;
            Utils.showToast(`方案「${name}」已更新`, 'success');
            this.nameInput.value = '';
            this.renderList();
            this.updateSaveSection();
        });
    }

    /**
     * 复制一份方案：复制其全部内容并切换到副本继续实验
     */
    handleDuplicate(id) {
        const source = this.getDesign(id);
        if (!source) return;

        const now = Date.now();
        const copy = Object.assign({}, Utils.deepClone(source), {
            id: Utils.generateId(),
            name: this.uniqueCopyName(source.name),
            createdAt: now,
            updatedAt: now,
            lenses: (source.lenses || []).map(lens =>
                Object.assign({}, lens, { id: Utils.generateId() }))
        });

        const next = this.designs.concat([copy]);
        this.commit(next, copy.id, () => {
            // 方案列表已在 commit 中写入并把当前选中切到副本，这里只恢复画布
            this.applyDesign(copy, { skipPersist: true });
            Utils.showToast('已复制一份方案，可以在此基础上修改', 'success');
            this.closeModal();
        });
    }

    /**
     * 切换到指定方案
     */
    handleApply(id) {
        const design = this.getDesign(id);
        if (design) this.applyDesign(design);
    }

    /**
     * 删除方案：第一次点击变为“确认删除”，2.5 秒内再次点击才执行
     */
    handleDeleteRequest(id, btn) {
        if (btn.dataset.confirming === '1') {
            this.handleDelete(id);
            return;
        }

        btn.dataset.confirming = '1';
        const originalText = btn.textContent;
        btn.textContent = '确认删除';
        btn.classList.add('confirming');

        setTimeout(() => {
            if (btn.isConnected) {
                btn.dataset.confirming = '';
                btn.textContent = originalText;
                btn.classList.remove('confirming');
            }
        }, 2500);
    }

    handleDelete(id) {
        const target = this.getDesign(id);
        if (!target) return;

        const next = this.designs.filter(d => d.id !== id);
        const newCurrentId = this.currentId === id ? null : this.currentId;

        this.commit(next, newCurrentId, () => {
            // 删的是当前方案：画布保留原样，仅取消“已保存方案”的归属
            if (this.currentId === id) {
                this.currentId = null;
            }
            Utils.showToast(`方案「${target.name}」已删除`, 'success');
            this.renderList();
            this.updateSaveSection();
        });
    }

    /**
     * 测验模式进入/退出时，画布会被清空，当前方案归属应解除
     */
    clearCurrentBinding() {
        this.currentId = null;
        this.dirty = false;
        Storage.setCurrentDesignId(null);
        if (!this.modal.classList.contains('hidden')) {
            this.renderList();
            this.updateSaveSection();
        }
    }

    /* ------------------------------------------------------------------ */
    /* 写入与失败重试                                                      */
    /* ------------------------------------------------------------------ */

    /**
     * 提交方案列表变更。
     * 只有 localStorage 写入成功后才更新内存中的方案，
     * 写入失败（如空间不足）时保留原方案并给出重试入口。
     *
     * @param {Array} nextDesigns 即将写入的完整列表
     * @param {string|null} nextCurrentId 写入后应选中的方案 ID
     * @param {Function} onSuccess
     */
    commit(nextDesigns, nextCurrentId, onSuccess) {
        // 上一次写入尚待重试时，避免新操作覆盖重试现场
        if (this.pendingCommit) {
            Utils.showToast('上一次保存还未成功，请先点击“重试”', 'warning');
            return;
        }

        const write = Storage.saveDesigns(nextDesigns);
        if (!write.ok) {
            // 保留 this.designs / this.currentId 不变，等待重试
            this.pendingCommit = { designs: nextDesigns, currentId: nextCurrentId, onSuccess };
            this.showWriteError(write.error);
            return;
        }

        const idWrite = Storage.setCurrentDesignId(nextCurrentId);
        if (!idWrite.ok) {
            // 方案本体已写入，仅“当前选中”记录失败：允许进入新方案，同时提示
            this.designs = nextDesigns;
            this.currentId = nextCurrentId;
            this.pendingCommit = { designs: null, currentId: nextCurrentId, onSuccess: null, idOnly: true };
            this.showWriteError(idWrite.error);
            this.renderList();
            this.updateSaveSection();
            return;
        }

        this.designs = nextDesigns;
        this.currentId = nextCurrentId;
        this.pendingCommit = null;
        this.hideWriteError();
        if (onSuccess) onSuccess();
    }

    /**
     * 重试上一次失败的写入
     */
    retryCommit() {
        const pending = this.pendingCommit;
        if (!pending) return;

        if (pending.idOnly) {
            const r = Storage.setCurrentDesignId(pending.currentId);
            if (r.ok) {
                this.pendingCommit = null;
                this.hideWriteError();
                Utils.showToast('保存成功', 'success');
            } else {
                this.showWriteError(r.error);
            }
            return;
        }

        const write = Storage.saveDesigns(pending.designs);
        if (!write.ok) {
            this.showWriteError(write.error);
            return;
        }
        const idWrite = Storage.setCurrentDesignId(pending.currentId);
        if (!idWrite.ok) {
            this.designs = pending.designs;
            this.currentId = pending.currentId;
            this.pendingCommit = { designs: null, currentId: pending.currentId, onSuccess: null, idOnly: true };
            this.showWriteError(idWrite.error);
            this.renderList();
            this.updateSaveSection();
            return;
        }

        const onSuccess = pending.onSuccess;
        this.designs = pending.designs;
        this.currentId = pending.currentId;
        this.pendingCommit = null;
        this.hideWriteError();
        Utils.showToast('保存成功', 'success');
        if (onSuccess) onSuccess();
    }

    /**
     * 显示写入失败提示（保留原方案，引导重试）
     */
    showWriteError(reason) {
        const text = reason === 'quota'
            ? '本地存储空间不足，方案没有被修改。请清理浏览器存储后重试。'
            : reason === 'read'
                ? '本地存储暂时无法访问，无法保存方案。'
                : '方案写入失败，原有方案已保留，请重试。';
        this.errorTextEl.textContent = text;
        this.errorEl.classList.remove('hidden');
    }

    hideWriteError() {
        this.errorEl.classList.add('hidden');
    }

    /* ------------------------------------------------------------------ */
    /* 模态框与列表渲染                                                    */
    /* ------------------------------------------------------------------ */

    openModal() {
        this.nameInput.value = '';
        this.hideWriteError();
        this.renderList();
        this.updateSaveSection();
        this.modal.classList.remove('hidden');
    }

    closeModal() {
        this.modal.classList.add('hidden');
    }

    /**
     * 渲染已保存方案列表：名称、创建时间、透镜数量、当前选中标记
     */
    renderList() {
        // 清空旧列表（保留空态与错误提示节点）
        this.listEl.querySelectorAll('.design-item').forEach(el => el.remove());

        if (this.designs.length === 0) {
            this.listEl.classList.add('hidden');
            this.emptyEl.classList.remove('hidden');
            return;
        }

        this.listEl.classList.remove('hidden');
        this.emptyEl.classList.add('hidden');

        const sorted = this.designs.slice().sort((a, b) => b.updatedAt - a.updatedAt);

        sorted.forEach(design => {
            const isCurrent = design.id === this.currentId;
            const item = document.createElement('div');
            item.className = 'design-item' + (isCurrent ? ' current' : '');
            item.dataset.id = design.id;

            const info = document.createElement('div');
            info.className = 'design-item-info';

            const nameLine = document.createElement('div');
            nameLine.className = 'design-item-name-line';
            const nameSpan = document.createElement('span');
            nameSpan.className = 'design-item-name';
            nameSpan.textContent = design.name;
            nameLine.appendChild(nameSpan);
            if (isCurrent) {
                const badge = document.createElement('span');
                badge.className = 'design-current-badge';
                badge.textContent = this.dirty ? '已修改' : '当前';
                nameLine.appendChild(badge);
            }
            info.appendChild(nameLine);

            const meta = document.createElement('div');
            meta.className = 'design-item-meta';
            meta.textContent =
                `创建于 ${Utils.formatDate(design.createdAt)} · 透镜 ${(design.lenses || []).length} 个`;
            info.appendChild(meta);

            const actions = document.createElement('div');
            actions.className = 'design-item-actions';

            actions.appendChild(this.makeActionButton('apply', '切换', isCurrent));
            actions.appendChild(this.makeActionButton('duplicate', '复制'));
            actions.appendChild(this.makeActionButton('delete', '删除'));

            item.appendChild(info);
            item.appendChild(actions);
            this.listEl.appendChild(item);
        });
    }

    makeActionButton(action, text, disabled = false) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-sm design-action-btn';
        if (action === 'delete') btn.classList.add('btn-danger');
        else btn.classList.add('btn-secondary');
        btn.dataset.action = action;
        btn.textContent = text;
        if (disabled) {
            btn.disabled = true;
            btn.textContent = '使用中';
        }
        return btn;
    }

    /**
     * 更新“保存为新方案 / 更新当前方案”区域
     */
    updateSaveSection() {
        const current = this.getDesign(this.currentId);
        if (current) {
            this.updateBtn.disabled = false;
            const label = this.dirty ? '更新当前方案' : '覆盖当前方案';
            this.updateBtn.querySelector('span').textContent = label;
            this.nameInput.placeholder = `不填则使用原名「${current.name}」`;
        } else {
            this.updateBtn.disabled = true;
            this.updateBtn.querySelector('span').textContent = '更新当前方案';
            this.nameInput.placeholder = '给新方案起个名字';
        }
    }

    markDirty() {
        if (this.dirty || !this.currentId) return;
        this.dirty = true;
        if (!this.modal.classList.contains('hidden')) {
            this.renderList();
            this.updateSaveSection();
        }
    }

    /* ------------------------------------------------------------------ */
    /* 工具方法                                                            */
    /* ------------------------------------------------------------------ */

    getDesign(id) {
        if (!id) return null;
        return this.designs.find(d => d.id === id) || null;
    }

    readName() {
        return (this.nameInput.value || '').trim().slice(0, 30);
    }

    defaultName() {
        const now = new Date();
        return `我的方案 ${Utils.formatDate(now)}`;
    }

    uniqueCopyName(sourceName) {
        const base = `${sourceName} 副本`;
        let name = base;
        let n = 2;
        const names = new Set(this.designs.map(d => d.name));
        while (names.has(name)) {
            name = `${base} ${n}`;
            n++;
        }
        return name;
    }

    /**
     * 清洗历史数据，保证列表项字段完整
     */
    normalizeDesigns(list) {
        return list.filter(d => d && typeof d === 'object' && d.id).map(d => ({
            id: d.id,
            name: typeof d.name === 'string' && d.name ? d.name : '未命名方案',
            createdAt: d.createdAt || d.updatedAt || Date.now(),
            updatedAt: d.updatedAt || d.createdAt || Date.now(),
            lenses: Array.isArray(d.lenses) ? d.lenses : [],
            light: Object.assign({
                mode: CONFIG.LIGHT_DEFAULTS.mode,
                rayCount: CONFIG.LIGHT_DEFAULTS.rayCount,
                incidentAngle: CONFIG.LIGHT_DEFAULTS.angle,
                isRunning: false,
                showLabels: true,
                showDispersion: false
            }, d.light || {})
        }));
    }
}
