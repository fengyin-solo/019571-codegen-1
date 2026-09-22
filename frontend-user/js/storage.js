/**
 * 本地存储管理
 *
 * 存储键相互独立，互不覆盖：
 * - 引导完成状态：optics_guide_completed
 * - 已保存设计方案：optics_designs
 * - 当前选中方案：optics_active_design_id
 */
const Storage = {
    GUIDE_KEY: CONFIG.STORAGE_KEYS.GUIDE_COMPLETED,
    DESIGNS_KEY: CONFIG.STORAGE_KEYS.DESIGNS,
    ACTIVE_DESIGN_KEY: CONFIG.STORAGE_KEYS.ACTIVE_DESIGN,

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
     * 重置引导状态（只清除引导键，不影响设计方案相关存储）
     */
    resetGuide() {
        try {
            localStorage.removeItem(this.GUIDE_KEY);
        } catch (e) {
            // 忽略存储错误
        }
    },

    /**
     * 读取已保存的设计方案列表，按更新时间倒序排列
     */
    getDesigns() {
        try {
            const raw = localStorage.getItem(this.DESIGNS_KEY);
            if (!raw) return [];

            const data = JSON.parse(raw);
            if (!Array.isArray(data)) return [];

            return data
                .filter(d => d && typeof d === 'object' && typeof d.id === 'string')
                .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        } catch (e) {
            // 数据损坏时视为空，避免清空操作前误判
            return [];
        }
    },

    /**
     * 获取单个设计方案
     */
    getDesign(id) {
        return this.getDesigns().find(d => d.id === id) || null;
    },

    /**
     * 整体写入设计方案列表。
     * 写入失败（含空间不足）时抛出异常，localStorage 中原有数据保持不变。
     */
    writeDesigns(designs) {
        try {
            localStorage.setItem(this.DESIGNS_KEY, JSON.stringify(designs));
        } catch (e) {
            // QuotaExceededError 等：setItem 为原子写入，原方案不会被覆盖
            throw e;
        }
    },

    /**
     * 保存或更新一份设计方案。
     * 写入失败时抛出异常，调用方应保留原方案并提示重试。
     */
    saveDesign(design) {
        const designs = this.getDesigns();
        const index = designs.findIndex(d => d.id === design.id);

        if (index > -1) {
            designs[index] = design;
        } else {
            designs.push(design);
        }

        this.writeDesigns(designs);
        return design;
    },

    /**
     * 删除一份设计方案。
     * 写入失败时抛出异常，原方案列表保持不变。
     */
    deleteDesign(id) {
        const designs = this.getDesigns().filter(d => d.id !== id);
        this.writeDesigns(designs);
    },

    /**
     * 获取当前选中的设计方案 ID
     */
    getActiveDesignId() {
        try {
            return localStorage.getItem(this.ACTIVE_DESIGN_KEY);
        } catch (e) {
            return null;
        }
    },

    /**
     * 记录当前选中的设计方案 ID（独立存储键）
     */
    setActiveDesignId(id) {
        try {
            if (id) {
                localStorage.setItem(this.ACTIVE_DESIGN_KEY, id);
            } else {
                localStorage.removeItem(this.ACTIVE_DESIGN_KEY);
            }
        } catch (e) {
            // 选中指针写入失败不影响方案数据本身
        }
    }
};
