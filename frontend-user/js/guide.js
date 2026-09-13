/**
 * 引导系统
 */
class GuideManager {
    constructor() {
        this.overlay = document.getElementById('guide-overlay');
        this.currentStep = 0;
        this.steps = [
            'guide-welcome',
            'guide-step-1',
            'guide-step-2',
            'guide-step-3'
        ];
        
        this.init();
    }
    
    /**
     * 初始化
     */
    init() {
        this.bindEvents();
        
        // 检查是否需要显示引导
        if (!Storage.isGuideCompleted()) {
            this.show();
        }
        
        // 监听显示引导事件
        window.addEventListener('showGuide', () => {
            this.show();
        });
    }
    
    /**
     * 绑定事件
     */
    bindEvents() {
        // 开始引导
        document.getElementById('btn-start-guide').addEventListener('click', () => {
            this.nextStep();
        });
        
        // 跳过引导
        document.getElementById('btn-skip-guide').addEventListener('click', () => {
            this.complete();
        });
        
        // 步骤导航
        document.getElementById('btn-step-1-next').addEventListener('click', () => {
            this.nextStep();
        });
        
        document.getElementById('btn-step-2-next').addEventListener('click', () => {
            this.nextStep();
        });
        
        document.getElementById('btn-finish-guide').addEventListener('click', () => {
            this.complete();
        });
    }
    
    /**
     * 显示引导
     */
    show() {
        this.currentStep = 0;
        this.showStep(0);
        this.overlay.classList.remove('hidden');
    }
    
    /**
     * 隐藏引导
     */
    hide() {
        this.overlay.classList.add('hidden');
    }
    
    /**
     * 显示指定步骤
     */
    showStep(index) {
        // 隐藏所有步骤
        this.steps.forEach(stepId => {
            document.getElementById(stepId).classList.add('hidden');
        });
        
        // 显示当前步骤
        if (index < this.steps.length) {
            document.getElementById(this.steps[index]).classList.remove('hidden');
        }
    }
    
    /**
     * 下一步
     */
    nextStep() {
        this.currentStep++;
        if (this.currentStep < this.steps.length) {
            this.showStep(this.currentStep);
        } else {
            this.complete();
        }
    }
    
    /**
     * 完成引导
     */
    complete() {
        Storage.setGuideCompleted();
        this.hide();
        Utils.showToast('开始你的光学探索之旅吧！', 'success');
    }
}
