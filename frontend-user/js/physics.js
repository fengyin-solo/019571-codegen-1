/**
 * 物理计算模块
 * 
 * 光路规律：
 * - 凸透镜：光线向中间会聚（向光轴偏折）
 * - 凹透镜：光线向外发散
 * - 平面透镜：不偏折
 * - 非球面透镜：消除球差，更精准的会聚
 * 
 * 非球面透镜原理：
 * - 球面透镜的问题：边缘光线偏折过度，导致球差（边缘光和中心光不汇聚到同一点）
 * - 非球面透镜解决方案：表面曲率从中心到边缘逐渐变化，补偿球差
 * - 数学模型：使用高阶修正项 z = r²/R + k*r⁴ + ... 来描述表面
 * 
 * 色散原理：
 * - 不同波长的光折射率不同（蓝光 > 绿光 > 红光）
 * - 阿贝数（Abbe number）描述色散程度，数值越大色散越小
 * - 低色散镜片使用特殊玻璃（如ED玻璃），阿贝数更高
 */
const Physics = {
    /**
     * 计算透镜焦距
     */
    calculateFocalLength(refractiveIndex, curvature, size) {
        const curvatureRadius = size * (100 - curvature) / 50 + size * 0.5;
        return curvatureRadius / (2 * (refractiveIndex - 1));
    },
    
    /**
     * 计算光线与透镜的交点
     */
    calculateRayLensIntersection(rayX, rayY, rayAngle, lens) {
        const lensX = lens.x;
        const lensY = lens.y;
        const halfHeight = lens.getHeight() / 2;
        
        const dirX = Math.cos(rayAngle);
        const dirY = Math.sin(rayAngle);
        
        if (Math.abs(dirX) < 0.001) {
            return null;
        }
        
        const dx = lensX - rayX;
        
        // 光线必须朝向透镜
        if ((dx > 0 && dirX < 0) || (dx < 0 && dirX > 0)) {
            return null;
        }
        
        // 距离太近跳过
        if (Math.abs(dx) < 5) {
            return null;
        }
        
        const t = dx / dirX;
        const intersectY = rayY + t * dirY;
        
        // 检查是否在透镜范围内
        if (intersectY < lensY - halfHeight || intersectY > lensY + halfHeight) {
            return null;
        }
        
        return {
            x: lensX,
            y: intersectY,
            distance: Math.abs(dx)
        };
    },
    
    /**
     * 计算球面透镜的球差
     * 球差：边缘光线比近轴光线偏折更多，导致焦点分散
     * @param {number} relativePos - 相对位置 (-1 到 1)
     * @returns {number} 球差系数
     */
    calculateSphericalAberration(relativePos) {
        // 球差与位置的四次方成正比（简化模型）
        // 边缘光线（|relativePos| 接近 1）球差最大
        const r2 = relativePos * relativePos;
        return r2 * r2 * 0.15; // 球差系数
    },
    
    /**
     * 计算非球面透镜的修正系数
     * 非球面设计：通过改变表面曲率来补偿球差
     * 
     * 非球面方程（简化）：z = cy² / (1 + sqrt(1 - (1+k)c²y²)) + A₄y⁴ + A₆y⁶
     * - c: 曲率
     * - k: 圆锥常数（k=0 球面，k<0 椭圆面，k=-1 抛物面）
     * - A₄, A₆: 高阶非球面系数
     * 
     * @param {number} relativePos - 相对位置 (-1 到 1)
     * @param {number} curvature - 曲率 (0-100)
     * @returns {number} 非球面修正后的偏折系数
     */
    calculateAsphericCorrection(relativePos, curvature) {
        const r = Math.abs(relativePos);
        const r2 = r * r;
        const r4 = r2 * r2;
        
        // 圆锥常数 k，用于控制非球面形状
        // k = -1 时为抛物面，能完美消除球差
        const k = -0.8 - (curvature / 100) * 0.4; // 根据曲率调整，范围 -0.8 到 -1.2
        
        // 高阶修正系数
        const A4 = -0.08 * (curvature / 100); // 四阶修正
        const A6 = -0.02 * (curvature / 100); // 六阶修正
        
        // 非球面修正：减少边缘光线的过度偏折
        // 1. 基础修正：使用圆锥常数减少球差
        const conicCorrection = 1 + k * r2 * 0.3;
        
        // 2. 高阶修正：进一步优化边缘光线
        const higherOrderCorrection = 1 + A4 * r4 + A6 * r4 * r2;
        
        // 综合修正系数（0.7 到 1.0 之间）
        // 边缘光线修正更多，中心光线几乎不变
        return Math.max(0.6, conicCorrection * higherOrderCorrection);
    },
    
    /**
     * 计算折射后的光线角度
     * 
     * 核心逻辑：
     * - 凸透镜：光线向光轴偏折（会聚），存在球差
     * - 凹透镜：光线远离光轴偏折（发散）
     * - 平面透镜：不偏折
     * - 非球面：消除球差，更精准的会聚
     */
    calculateRefractedAngle(rayAngle, rayY, lens) {
        const lensY = lens.y;  // 透镜中心Y（光轴位置）
        const halfHeight = lens.getHeight() / 2;
        
        // 光线相对于光轴的位置：正数在下方，负数在上方
        const offsetFromAxis = rayY - lensY;
        
        // 相对位置 -1 到 1
        const relativePos = offsetFromAxis / halfHeight;
        
        // 折射率影响偏折程度
        const n = lens.refractiveIndex;
        // 曲率影响偏折程度
        const curvature = lens.curvature / 100;
        
        // 基础偏折强度
        const baseStrength = (n - 1) * curvature * 0.8;
        
        // 计算偏折角度
        let deflection = 0;
        
        switch (lens.type) {
            case CONFIG.LENS_TYPES.CONVEX:
                // 凸透镜：光线向光轴偏折（会聚）
                // 包含球差：边缘光线偏折更多
                const sphericalAberration = this.calculateSphericalAberration(relativePos);
                deflection = -relativePos * baseStrength * (1 + sphericalAberration);
                break;
                
            case CONFIG.LENS_TYPES.CONCAVE:
                // 凹透镜：光线远离光轴偏折（发散）
                deflection = relativePos * baseStrength;
                break;
                
            case CONFIG.LENS_TYPES.PLANO:
                // 平面透镜：不偏折
                deflection = 0;
                break;
                
            case CONFIG.LENS_TYPES.ASPHERIC:
                // 非球面透镜：消除球差，精准会聚
                // 1. 计算非球面修正系数
                const asphericCorrection = this.calculateAsphericCorrection(relativePos, lens.curvature);
                
                // 2. 应用修正：边缘光线偏折减少，使所有光线汇聚到同一焦点
                // 非球面的关键：边缘曲率更平缓，减少边缘光线的过度偏折
                deflection = -relativePos * baseStrength * asphericCorrection;
                break;
        }
        
        // 返回新的光线角度
        return rayAngle + deflection;
    },
    
    /**
     * 计算色散效果 - 增强版
     * 
     * 色散原理：
     * - 柯西公式：n(λ) = A + B/λ² + C/λ⁴
     * - 不同波长折射率：n_blue > n_green > n_red
     * - 阿贝数 Vd = (nd - 1) / (nF - nC)，描述色散程度
     * 
     * 波长参考（nm）：
     * - 红光 (C线): 656.3nm
     * - 绿光 (d线): 587.6nm  
     * - 蓝光 (F线): 486.1nm
     * 
     * @param {number} baseIndex - 基础折射率（绿光/d线）
     * @param {number} dispersion - 色散系数（0-1，越大色散越明显）
     * @param {string} color - 光线颜色 ('red', 'green', 'blue')
     * @returns {number} 该颜色光的折射率
     */
    calculateDispersionIndex(baseIndex, dispersion, color) {
        // 波长（nm）
        const wavelengths = {
            red: 656.3,    // C线
            green: 587.6,  // d线（基准）
            blue: 486.1    // F线
        };
        
        const lambda = wavelengths[color] || wavelengths.green;
        const lambda0 = wavelengths.green; // 基准波长
        
        // 使用简化的柯西公式计算折射率变化
        // Δn = B * (1/λ² - 1/λ0²)
        // B 系数与色散程度相关
        const B = dispersion * 8000; // 柯西B系数，与色散成正比
        
        const deltaIndex = B * (1 / (lambda * lambda) - 1 / (lambda0 * lambda0));
        
        // 低色散镜片：dispersion 小，deltaIndex 变化小
        // 普通玻璃：dispersion 大，deltaIndex 变化大
        return baseIndex + deltaIndex;
    },
    
    /**
     * 计算阿贝数（色散系数的倒数指标）
     * 阿贝数越大，色散越小
     * - 普通玻璃：Vd ≈ 30-40
     * - 低色散玻璃（ED）：Vd ≈ 80-95
     * 
     * @param {number} baseIndex - 基础折射率
     * @param {number} dispersion - 色散系数
     * @returns {number} 阿贝数
     */
    calculateAbbeNumber(baseIndex, dispersion) {
        if (dispersion <= 0) return Infinity;
        
        const nF = this.calculateDispersionIndex(baseIndex, dispersion, 'blue');
        const nC = this.calculateDispersionIndex(baseIndex, dispersion, 'red');
        const nd = baseIndex;
        
        return (nd - 1) / (nF - nC);
    },
    
    /**
     * 生成平行光线（从左边水平射入）
     */
    generateParallelRays(canvasHeight, rayCount, angle) {
        const rays = [];
        const angleRad = Utils.degToRad(angle);
        const spacing = canvasHeight / (rayCount + 1);
        
        for (let i = 1; i <= rayCount; i++) {
            rays.push({ x: 0, y: spacing * i, angle: angleRad });
        }
        return rays;
    },
    
    /**
     * 生成点光源光线
     */
    generatePointSourceRays(sourceX, sourceY, rayCount, spreadAngle = 60) {
        const rays = [];
        const halfSpread = Utils.degToRad(spreadAngle / 2);
        const step = rayCount > 1 ? (2 * halfSpread) / (rayCount - 1) : 0;
        
        for (let i = 0; i < rayCount; i++) {
            rays.push({
                x: sourceX,
                y: sourceY,
                angle: -halfSpread + step * i
            });
        }
        return rays;
    }
};
