/**
 * 设计方案管理器
 *
 * 将画布上的透镜组合、光源模式与可调参数整体保存为命名方案，
 * 支持方案切换、复制与删除。方案列表与当前选中方案分别存储在
 * 独立的 localStorage 键中，与引导状态互不影响。
 */
class DesignManager {
    constructor(canvasManager, interactionManager) {
        this.canvasManager = canvasManager;
        this.interactionManager = interactionManager;
        this.activeId = null;
        this.pendingWrite = null; // 最近一次写入失败的操作，供“重试”使用

        this.init();
    }

    init() {
        this.bindEvents();
        this.restoreActiveDesign();
    }

    /**
     * 绑定界面事件
     */
    bindEvents() {
        // 顶栏入口
        const btnOpen = document.getElementById('btn-designs');
        if (btnOpen) {
            btnOpen.addEventListener('click', () => this.openModal());
        }

        // 关闭模态框
        const btnClose = document.getElementById('btn-design-close');
        if (btnClose) {
            btnClose.addEventListener('click', () => this.closeModal());
        }

        // 保存 / 更新当前方案
        const btnSave = document.getElementById('btn-design-save');
        if (btnSave) {
            btnSave.addEventListener('click', () => this.saveCurrent());
        }

        // 写入失败后的重试
        const btnRetry = document.getElementById('btn-design-retry');
        if (btnRetry) {
            btnRetry.addEventListener('click', () => {
                if (this.pendingWrite) this.pendingWrite();
            });
        }

        // 手动重置画布后，取消“当前选中方案”指针
        window.addEventListener('canvasReset', () => {
            this.activeId = null;
            Storage.setActiveDesignId(null);
        });
    }

    /**
     * 打开方案管理模态框
     */
    openModal() {
        const app = document.getElementById('app');
        if (app && app.classList.contains('quiz-mode')) {
            Utils.showToast('测验模式下暂不管理设计方案，请先退出测验', 'warning');
            return;
        }

        const modal = document.getElementById('design-modal');
        if (!modal) return;

        this.hideWriteError();
        this.renderSaveArea();
        this.renderList();
        modal.classList.remove('hidden');
    }

    closeModal() {
        const modal = document.getElementById('design-modal');
        if (modal) modal.classList.add('hidden');
    }

    /**
     * 刷新后恢复上次选中的方案
     */
    restoreActiveDesign() {
        const id = Storage.getActiveDesignId();
        if (!id) return;

        const design = Storage.getDesign(id);
        if (design) {
            this.activeId = id;
            this.applyDesign(design);
        } else {
            // 选中的方案已不存在，清理悬空指针
            this.activeId = null;
            Storage.setActiveDesignId(null);
        }
    }

    /**
     * 采集画布与光源的完整状态
     */
    captureState() {
        return {
            lenses: Utils.deepClone(this.canvasManager.getState().lenses),
            light: Utils.deepClone(this.interactionManager.getLightState())
        };
    }

    /**
     * 将一份方案应用到画布与光源
     */
    applyDesign(design) {
        this.canvasManager.loadLenses(design.lenses);
        this.interactionManager.setLightState(design.light);
    }

    /**
     * 保存当前画布：已选中已有方案则更新，否则创建新方案
     */
    saveCurrent() {
        const input = document.getElementById('design-name-input');
        const name = input.value.trim();

        if (!name) {
            Utils.showToast('请先输入方案名称', 'warning');
            input.focus();
            return;
        }

        const existing = this.activeId ? Storage.getDesign(this.activeId) : null;
        const now = Date.now();
        const state = this.captureState();

        const design = {
            id: existing ? existing.id : Utils.generateId(),
            name,
            createdAt: existing ? existing.createdAt : now,
            updatedAt: now,
            lenses: state.lenses,
            light: state.light
        };

        const isUpdate = !!existing;
        this.runWrite(
            isUpdate ? '方案修改保存失败' : '方案保存失败',
            () => Storage.saveDesign(design),
            () => {
                this.activeId = design.id;
                Storage.setActiveDesignId(design.id);
                Utils.showToast(isUpdate ? `方案「${name}」已更新` : `方案「${name}」已保存`, 'success');
                this.renderSaveArea();
                this.renderList();
            }
        );
    }

    /**
     * 切换到指定方案
     */
    switchTo(design) {
        this.applyDesign(design);
        this.activeId = design.id;
        Storage.setActiveDesignId(design.id);
        this.closeModal();
        Utils.showToast(`已切换到「${design.name}」`, 'success');
    }

    /**
     * 复制一份方案并切换到副本，便于在此基础上改出新方案
     */
    duplicate(design) {
        const now = Date.now();
        const copy = Utils.deepClone(design);
        copy.id = Utils.generateId();
        copy.name = `${design.name} 副本`;
        copy.lenses.forEach(lens => {
            lens.id = Utils.generateId();
        });
        copy.createdAt = now;
        copy.updatedAt = now;

        this.runWrite('方案复制失败', () => Storage.saveDesign(copy), () => {
            this.activeId = copy.id;
            Storage.setActiveDesignId(copy.id);
            this.applyDesign(copy);
            Utils.showToast(`已复制为「${copy.name}」`, 'success');
            this.renderSaveArea();
            this.renderList();
        });
    }

    /**
     * 删除指定方案
     */
    remove(design) {
        if (!window.confirm(`确定删除「${design.name}」吗？此操作不可恢复。`)) return;

        this.runWrite('方案删除失败', () => Storage.deleteDesign(design.id), () => {
            if (this.activeId === design.id) {
                // 画布内容保留为当前实验状态，仅清除选中指针
                this.activeId = null;
                Storage.setActiveDesignId(null);
            }
            Utils.showToast(`方案「${design.name}」已删除`, 'success');
            this.renderSaveArea();
            this.renderList();
        });
    }

    /**
     * 执行本地存储写操作；失败时保留原数据并提示重试
     */
    runWrite(errorText, operation, onSuccess) {
        try {
            operation();
            this.hideWriteError();
            this.pendingWrite = null;
            if (onSuccess) onSuccess();
        } catch (e) {
            // localStorage 写入失败（如空间不足）：原方案列表不会被覆盖
            this.showWriteError(errorText);
            this.pendingWrite = () => this.runWrite(errorText, operation, onSuccess);
        }
    }

    showWriteError(text) {
        const banner = document.getElementById('design-write-error');
        const textEl = document.getElementById('design-error-text');
        if (textEl) {
            textEl.textContent = `${text}，原有方案已保留，请重试`;
        }
        if (banner) banner.classList.remove('hidden');
        Utils.showToast('本地存储空间可能不足，请重试', 'error', 3000);
    }

    hideWriteError() {
        const banner = document.getElementById('design-write-error');
        if (banner) banner.classList.add('hidden');
    }

    /**
     * 根据当前选中方案刷新名称输入区与保存按钮文案
     */
    renderSaveArea() {
        const input = document.getElementById('design-name-input');
        const btnSave = document.getElementById('btn-design-save');
        const active = this.activeId ? Storage.getDesign(this.activeId) : null;

        if (active) {
            input.value = active.name;
            btnSave.textContent = '保存修改';
        } else {
            input.value = '';
            btnSave.textContent = '保存方案';
        }
    }

    /**
     * 渲染已保存方案列表（名称、创建时间、透镜数量）
     */
    renderList() {
        const listEl = document.getElementById('design-list');
        const emptyEl = document.getElementById('design-empty');
        const designs = Storage.getDesigns();

        listEl.innerHTML = '';

        if (designs.length === 0) {
            emptyEl.classList.remove('hidden');
            listEl.classList.add('hidden');
            return;
        }

        emptyEl.classList.add('hidden');
        listEl.classList.remove('hidden');

        designs.forEach(design => {
            listEl.appendChild(this.createDesignItem(design));
        });
    }

    createDesignItem(design) {
        const item = document.createElement('div');
        item.className = 'design-item';
        if (design.id === this.activeId) {
            item.classList.add('active');
        }

        const info = document.createElement('div');
        info.className = 'design-item-info';

        const nameRow = document.createElement('div');
        nameRow.className = 'design-item-name-row';

        const nameEl = document.createElement('span');
        nameEl.className = 'design-item-name';
        nameEl.textContent = design.name;
        nameRow.appendChild(nameEl);

        if (design.id === this.activeId) {
            const badge = document.createElement('span');
            badge.className = 'design-item-badge';
            badge.textContent = '当前';
            nameRow.appendChild(badge);
        }

        const metaEl = document.createElement('span');
        metaEl.className = 'design-item-date';
        const lensCount = Array.isArray(design.lenses) ? design.lenses.length : 0;
        metaEl.textContent =
            `${Utils.formatDate(design.createdAt)} · ${lensCount} 个透镜`;

        info.appendChild(nameRow);
        info.appendChild(metaEl);

        const actions = document.createElement('div');
        actions.className = 'design-item-actions';

        const btnSwitch = document.createElement('button');
        btnSwitch.className = 'btn btn-primary btn-sm';
        btnSwitch.textContent = '切换';
        btnSwitch.addEventListener('click', () => this.switchTo(design));

        const btnCopy = document.createElement('button');
        btnCopy.className = 'btn btn-secondary btn-sm';
        btnCopy.textContent = '复制';
        btnCopy.addEventListener('click', () => this.duplicate(design));

        const btnDelete = document.createElement('button');
        btnDelete.className = 'btn btn-danger btn-sm';
        btnDelete.textContent = '删除';
        btnDelete.addEventListener('click', () => this.remove(design));

        actions.appendChild(btnSwitch);
        actions.appendChild(btnCopy);
        actions.appendChild(btnDelete);

        item.appendChild(info);
        item.appendChild(actions);
        return item;
    }
}
