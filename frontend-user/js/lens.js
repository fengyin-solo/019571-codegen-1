/**
 * 透镜类
 */
class Lens {
    constructor(options = {}) {
        this.id = options.id || Utils.generateId();
        this.type = options.type || CONFIG.LENS_TYPES.CONVEX;
        this.x = options.x || 0;
        this.y = options.y || 0;
        this.size = options.size || CONFIG.LENS_DEFAULTS.size;
        this.curvature = options.curvature || CONFIG.LENS_DEFAULTS.curvature;
        this.material = options.material || CONFIG.LENS_DEFAULTS.material;
        this.selected = false;
        this._materialApplied = null;

        // 先根据材料确定色散系数（首次应用不会改动折射率）
        this.applyMaterial(this.material);

        // 折射率：优先使用方案中保存的值；新建时沿用材料默认值
        if (options.refractiveIndex !== undefined && options.refractiveIndex !== null) {
            this.refractiveIndex = options.refractiveIndex;
        }
    }

    /**
     * 应用材料预设。初始化恢复时仅设置色散；用户主动切换材料时
     * 折射率同步为新材料的默认值。
     */
    applyMaterial(materialId) {
        let material;
        switch (materialId) {
            case 'highIndex':
                material = CONFIG.MATERIALS.HIGH_INDEX;
                break;
            case 'lowDispersion':
                material = CONFIG.MATERIALS.LOW_DISPERSION;
                break;
            default:
                material = CONFIG.MATERIALS.NORMAL;
        }

        const changed = this._materialApplied !== null && this._materialApplied !== material.id;
        this.material = material.id;
        this.dispersion = material.dispersion;
        if (changed) {
            this.refractiveIndex = material.refractiveIndex;
        } else if (this.refractiveIndex === undefined) {
            this.refractiveIndex = material.refractiveIndex;
        }
        this._materialApplied = this.material;
    }
    
    /**
     * 获取透镜高度
     */
    getHeight() {
        return 80 * (this.size / 100);
    }
    
    /**
     * 获取透镜宽度
     */
    getWidth() {
        const baseWidth = this.type === CONFIG.LENS_TYPES.PLANO ? 8 : 30;
        return baseWidth * (this.size / 100) * (this.curvature / 50);
    }
    
    /**
     * 获取焦距
     */
    getFocalLength() {
        if (this.type === CONFIG.LENS_TYPES.PLANO) {
            return Infinity;
        }
        
        const sign = this.type === CONFIG.LENS_TYPES.CONCAVE ? -1 : 1;
        return sign * Physics.calculateFocalLength(this.refractiveIndex, this.curvature, this.getHeight());
    }
    
    /**
     * 检测点是否在透镜内
     */
    containsPoint(px, py) {
        const halfWidth = this.getWidth() / 2 + 10; // 增加点击区域
        const halfHeight = this.getHeight() / 2 + 10;
        
        return px >= this.x - halfWidth && 
               px <= this.x + halfWidth &&
               py >= this.y - halfHeight && 
               py <= this.y + halfHeight;
    }
    
    /**
     * 获取透镜类型名称
     */
    getTypeName() {
        const names = {
            [CONFIG.LENS_TYPES.CONVEX]: '凸透镜',
            [CONFIG.LENS_TYPES.CONCAVE]: '凹透镜',
            [CONFIG.LENS_TYPES.PLANO]: '平面透镜',
            [CONFIG.LENS_TYPES.ASPHERIC]: '非球面透镜'
        };
        return names[this.type] || '透镜';
    }
    
    /**
     * 获取材料名称
     */
    getMaterialName() {
        const names = {
            normal: '普通玻璃',
            highIndex: '高折射率镜片',
            lowDispersion: '低色散镜片'
        };
        return names[this.material] || '普通玻璃';
    }
    
    /**
     * 重置为默认参数
     */
    reset() {
        this.refractiveIndex = CONFIG.LENS_DEFAULTS.refractiveIndex;
        this.size = CONFIG.LENS_DEFAULTS.size;
        this.curvature = CONFIG.LENS_DEFAULTS.curvature;
        this.material = CONFIG.LENS_DEFAULTS.material;
        this.dispersion = CONFIG.MATERIALS.NORMAL.dispersion;
        this._materialApplied = this.material;
    }

    /**
     * 序列化为JSON
     */
    toJSON() {
        return {
            id: this.id,
            type: this.type,
            x: this.x,
            y: this.y,
            refractiveIndex: this.refractiveIndex,
            size: this.size,
            curvature: this.curvature,
            material: this.material,
            dispersion: this.dispersion
        };
    }
    
    /**
     * 从JSON创建透镜
     */
    static fromJSON(json) {
        return new Lens(json);
    }
}
