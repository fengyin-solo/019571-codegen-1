/**
 * 画布管理器
 */
class CanvasManager {
    constructor() {
        this.canvas = document.getElementById('optics-canvas');
        this.wrapper = document.getElementById('canvas-wrapper');
        this.renderer = new Renderer(this.canvas);
        this.lenses = [];
        this.selectedLens = null;
        this.isDragging = false;
        this.dragOffset = { x: 0, y: 0 };
        
        this.init();
    }
    
    init() {
        this.bindEvents();
        this.handleResize();
    }
    
    bindEvents() {
        // 窗口大小变化
        window.addEventListener('resize', Utils.debounce(() => {
            this.handleResize();
        }, 100));
        
        // 鼠标事件
        this.canvas.addEventListener('mousedown', (e) => this.handlePointerDown(e));
        this.canvas.addEventListener('mousemove', (e) => this.handlePointerMove(e));
        this.canvas.addEventListener('mouseup', () => this.handlePointerUp());
        this.canvas.addEventListener('mouseleave', () => this.handlePointerUp());
        
        // 触摸事件 - 关键：正确处理触摸
        this.canvas.addEventListener('touchstart', (e) => {
            e.preventDefault();
            this.handlePointerDown(e);
        }, { passive: false });
        
        this.canvas.addEventListener('touchmove', (e) => {
            e.preventDefault();
            this.handlePointerMove(e);
        }, { passive: false });
        
        this.canvas.addEventListener('touchend', (e) => {
            e.preventDefault();
            this.handlePointerUp();
        }, { passive: false });
        
        this.canvas.addEventListener('touchcancel', () => this.handlePointerUp());
        
        // 拖放事件（桌面端）
        this.wrapper.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.wrapper.addEventListener('dragleave', () => this.handleDragLeave());
        this.wrapper.addEventListener('drop', (e) => this.handleDrop(e));
    }
    
    /**
     * 获取指针位置（兼容鼠标和触摸）
     */
    getPointerPos(e) {
        const rect = this.canvas.getBoundingClientRect();
        let clientX, clientY;
        
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            clientX = e.changedTouches[0].clientX;
            clientY = e.changedTouches[0].clientY;
        } else {
            clientX = e.clientX;
            clientY = e.clientY;
        }
        
        // 计算相对于画布的位置
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        
        return { x, y };
    }
    
    handleResize() {
        this.renderer.resize();
        
        this.lenses.forEach(lens => {
            lens.x = Utils.clamp(lens.x, 50, this.renderer.width - 50);
            lens.y = Utils.clamp(lens.y, 50, this.renderer.height - 50);
        });
        
        this.renderer.setLenses(this.lenses);
    }
    
    handlePointerDown(e) {
        const pos = this.getPointerPos(e);
        const lens = this.renderer.getLensAtPoint(pos.x, pos.y);
        
        if (lens) {
            this.selectLens(lens);
            this.isDragging = true;
            this.dragOffset = {
                x: pos.x - lens.x,
                y: pos.y - lens.y
            };
        } else {
            this.deselectLens();
        }
    }
    
    handlePointerMove(e) {
        if (!this.isDragging || !this.selectedLens) return;
        
        const pos = this.getPointerPos(e);
        
        this.selectedLens.x = Utils.clamp(
            pos.x - this.dragOffset.x,
            50,
            this.renderer.width - 50
        );
        this.selectedLens.y = Utils.clamp(
            pos.y - this.dragOffset.y,
            50,
            this.renderer.height - 50
        );
        
        this.renderer.render();
    }
    
    handlePointerUp() {
        this.isDragging = false;
    }
    
    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        document.getElementById('canvas-drop-hint').classList.remove('hidden');
    }
    
    handleDragLeave() {
        document.getElementById('canvas-drop-hint').classList.add('hidden');
    }
    
    handleDrop(e) {
        e.preventDefault();
        document.getElementById('canvas-drop-hint').classList.add('hidden');
        
        const lensType = e.dataTransfer.getData('lens-type');
        const material = e.dataTransfer.getData('lens-material');
        
        if (!lensType) return;
        
        const pos = this.getPointerPos(e);
        
        const lens = new Lens({
            type: lensType,
            x: pos.x,
            y: pos.y,
            material: material || 'normal'
        });
        
        this.addLens(lens);
        this.selectLens(lens);
        Utils.showToast('透镜已添加', 'success');
    }
    
    addLens(lens) {
        this.lenses.push(lens);
        this.renderer.setLenses(this.lenses);
    }
    
    removeLens(lens) {
        const index = this.lenses.indexOf(lens);
        if (index > -1) {
            this.lenses.splice(index, 1);
            if (this.selectedLens === lens) {
                this.deselectLens();
            }
            this.renderer.setLenses(this.lenses);
        }
    }
    
    selectLens(lens) {
        if (this.selectedLens) {
            this.selectedLens.selected = false;
        }
        
        this.selectedLens = lens;
        lens.selected = true;
        this.renderer.render();
        
        window.dispatchEvent(new CustomEvent('lensSelected', { detail: lens }));
    }
    
    deselectLens() {
        if (this.selectedLens) {
            this.selectedLens.selected = false;
            this.selectedLens = null;
            this.renderer.render();
        }
        
        window.dispatchEvent(new CustomEvent('lensDeselected'));
    }
    
    clear() {
        this.lenses = [];
        this.selectedLens = null;
        this.isDragging = false;
        this.renderer.setLenses([]);
        this.renderer.render();

        // 画布被清空（手动重置、测验流程等），通知方案管理清除选中指针
        window.dispatchEvent(new CustomEvent('canvasReset'));
    }

    /**
     * 加载一批透镜（替换画布上现有内容）
     */
    loadLenses(lensDataList) {
        const dataList = Array.isArray(lensDataList) ? lensDataList : [];

        this.lenses = dataList.map(data => {
            const lens = Lens.fromJSON(data);
            // 画布尺寸可能与保存时不同，限制在可视范围内
            lens.x = Utils.clamp(lens.x, 50, this.renderer.width - 50);
            lens.y = Utils.clamp(lens.y, 50, this.renderer.height - 50);
            lens.selected = false;
            return lens;
        });

        this.selectedLens = null;
        this.isDragging = false;
        this.renderer.setLenses(this.lenses);

        // 同步右侧参数面板为空态
        window.dispatchEvent(new CustomEvent('lensDeselected'));
    }

    /**
     * 导出画布当前状态（透镜组合数据）
     */
    getState() {
        return {
            lenses: this.lenses.map(lens => lens.toJSON())
        };
    }

    getRenderer() {
        return this.renderer;
    }
}
