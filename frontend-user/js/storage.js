/**
 * 本地存储管理
 *
 * 存储键相互独立、互不覆盖：
 * - optics_guide_completed：引导完成状态
 * - optics_designs：已保存的设计方案列表
 * - optics_current_design：当前选中的方案 ID
 */
const Storage = {
    GUIDE_KEY: CONFIG.STORAGE_KEYS.GUIDE_COMPLETED,
    DESIGNS_KEY: CONFIG.STORAGE_KEYS.DESIGNS,
    CURRENT_DESIGN_KEY: CONFIG.STORAGE_KEYS.CURRENT_DESIGN,

    /**
     * 检查引导是否完成
     */
    isGuideCompleted() {
        try {
            return localStorage.getItem(this.GUIDE_KEY) === 'true';
        } catch (e) {
            return false;
        }
    },

    /**
     * 标记引导完成
     */
    setGuideCompleted() {
        try {
            localStorage.setItem(this.GUIDE_KEY, 'true');
        } catch (e) {
            // 忽略存储错误
        }
    },

    /**
     * 重置引导状态（只操作引导键，不影响设计方案相关存储）
     */
    resetGuide() {
        try {
            localStorage.removeItem(this.GUIDE_KEY);
        } catch (e) {
            // 忽略存储错误
        }
    },

    /**
     * 读取全部已保存的设计方案
     * @returns {{ok: true, designs: Array}|{ok: false, error: string}}
     */
    getDesigns() {
        try {
            const raw = localStorage.getItem(this.DESIGNS_KEY);
            if (!raw) {
                return { ok: true, designs: [] };
            }

            const parsed = JSON.parse(raw);
            let designs = null;
            if (Array.isArray(parsed)) {
                designs = parsed;
            } else if (parsed && Array.isArray(parsed.designs)) {
                designs = parsed.designs;
            }

            if (!designs) {
                return { ok: false, error: '数据格式已损坏' };
            }
            return { ok: true, designs };
        } catch (e) {
            return { ok: false, error: (e && e.message) || '读取失败' };
        }
    },

    /**
     * 整体写入设计方案列表
     *
     * 先在内存中完成序列化；localStorage.setItem 在空间不足等情况下会抛异常，
     * 此时原键值保持不变（浏览器不会写入半截数据），从而保留原有方案。
     *
     * @returns {{ok: true}|{ok: false, error: string}} error 为 'quota' 表示空间不足
     */
    saveDesigns(designs) {
        let payload;
        try {
            payload = JSON.stringify({ version: 1, designs });
        } catch (e) {
            return { ok: false, error: this.describeWriteError(e) };
        }

        try {
            localStorage.setItem(this.DESIGNS_KEY, payload);
            return { ok: true };
        } catch (e) {
            // 写入失败：不修改内存外的任何状态，原有方案仍完整保留
            return { ok: false, error: this.describeWriteError(e) };
        }
    },

    /**
     * 读取当前选中的设计方案 ID
     * @returns {string|null}
     */
    getCurrentDesignId() {
        try {
            return localStorage.getItem(this.CURRENT_DESIGN_KEY);
        } catch (e) {
            return null;
        }
    },

    /**
     * 记录当前选中的设计方案 ID；传 null 表示取消选中
     * @returns {{ok: true}|{ok: false, error: string}}
     */
    setCurrentDesignId(id) {
        try {
            if (id === null || id === undefined) {
                localStorage.removeItem(this.CURRENT_DESIGN_KEY);
            } else {
                localStorage.setItem(this.CURRENT_DESIGN_KEY, id);
            }
            return { ok: true };
        } catch (e) {
            return { ok: false, error: this.describeWriteError(e) };
        }
    },

    /**
     * 归一化写入错误类型
     */
    describeWriteError(e) {
        if (e && (e.name === 'QuotaExceededError' ||
            e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
            e.code === 22 || e.code === 1014)) {
            return 'quota';
        }
        return 'write';
    }
};
