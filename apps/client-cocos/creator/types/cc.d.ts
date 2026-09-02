// Creator 引擎模块宽松声明：本 tsconfig 的职责是「业务代码 vs 同步契约」的漂移检查
// （如 Playback 必填字段缺失），不是引擎 API 类型校验。引擎完整类型由 Creator 编辑器提供。
declare module 'cc' {
  export class Component {
    node: any;
    onLoad?(): void;
    start?(): void;
    update?(dt?: number): void;
    onDestroy?(): void;
  }
  export class Node {
    constructor(name?: string);
    parent: any;
    layer: any;
    static EventType: any;
    addComponent<T = any>(type: any): T;
    on(type: string, cb: any, target?: any): void;
  }
  export class Texture2D {
    image: any;
    uploadData(src: any): void;
    static PixelFormat: { RGBA8888: any };
  }
  export class ImageAsset { constructor(src: any) }
  export class SpriteFrame { texture: any }
  export class Sprite {
    spriteFrame: any;
    static Type: { SIMPLE: any };
  }
  export class UITransform { setContentSize(w: number, h: number): void }
  export type EventTouch = any;
  export const _decorator: { ccclass(name?: string): any };
  export const sys: any;
}
