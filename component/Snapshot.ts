import { _decorator, Node, Component, Camera, RenderTexture, view, UITransform, ImageAsset, Texture2D, SpriteFrame, Sprite, sys, Size, native, assetManager, instantiate, Vec3, size, gfx } from 'cc';
import { CanvasHelper } from '../utils/CanvasHelper';
const { ccclass, property } = _decorator;

/**
 * @description 快照节点
 * 注意，只会截图快照摄像头下的可见节点
 * 如果需要拍照全部分，请设置screenShotCamera的Visibility
 */
@ccclass('Snapshot')
export class Snapshot extends Component {
    
    @property(Camera)
    snapCamera: Camera;

    /**@description 截图完成,调试时用来检查截图是否正确 */
    onCaptureComplete?: (isOk: boolean, path: string, spriteframe: SpriteFrame, size: Size) => void = undefined;

    private _texture: RenderTexture = null!;
    private _canvas: HTMLCanvasElement = null!;
    private _buffer: Uint8Array = null!;

    public captureNode(filename : string, cnode : Node = null) {
        cnode = cnode || this.node;
        cnode.active = true;
        this._texture = new RenderTexture();
        let trans = this.node.getComponent(UITransform);
        let box = trans.getBoundingBoxToWorld()
        let viewSize = {
            width: box.width,
            height: box.height,
        }
        this._texture.reset(viewSize);
        this.snapCamera.orthoHeight = box.height / 2;
        let cameraX = box.x + box.width / 2;
        let cameraY = box.y + box.height / 2;
        this.snapCamera.node.setWorldPosition(new Vec3(cameraX, cameraY, 0))
        this.snapCamera.targetTexture = this._texture;
        this.snapCamera.node.active = true;
        this.scheduleOnce(() => {
            this._capture(cnode, filename, viewSize);
        }, 0.2)
    }

    private _capture(cnode: Node, filename: string, viewSize: any) {
        let trans = cnode.getComponent(UITransform);
        if (!trans) {
            return;
        }
        let worldPos = trans.getBoundingBoxToWorld();
        let x = worldPos.x;
        let y = worldPos.y;
        let width = worldPos.width;
        let height = worldPos.height;

        if(sys.isNative && sys.os == "iOS") {
            y = viewSize.height - y - height
        }
        console.log("rect:", x, y, width, height)
        this._buffer = this._texture.readPixels(Math.floor(x), Math.floor(y), width, height) as Uint8Array;
        cnode.active = false;
        this.snapCamera.node.active = false;
        this.saveImage(cnode, filename);
    }

    /**@description 生成SpriteFrame */
    private genSpriteFrame(width: number, height: number) {
        let img = new ImageAsset();
        img.reset({
            _data: this._buffer,
            width: width,
            height: height,
            format: Texture2D.PixelFormat.RGBA8888,
            _compressed: false
        });
        let texture = new Texture2D();
        texture.image = img;
        let sf = new SpriteFrame();
        sf.texture = texture;
        sf.packable = false;
        sf.flipUVY = true;
        return sf;
    }

    private createImageData(width: number, height: number, arrayBuffer: Uint8Array) {
        if (sys.isBrowser || sys.platform === sys.Platform.WECHAT_GAME) {
            if (!this._canvas) {
                this._canvas = document.createElement('canvas');
                this._canvas.width = width;
                this._canvas.height = height;
            } else {
                this.clearCanvas();
            }
            let ctx = this._canvas.getContext('2d')!;
            let rowBytes = width * 4;
            for (let row = 0; row < height; row++) {
                let sRow = height - 1 - row;
                let imageData = ctx.createImageData(width, 1);
                let start = sRow * width * 4;
                for (let i = 0; i < rowBytes; i++) {
                    imageData.data[i] = arrayBuffer[start + i];
                }
                ctx.putImageData(imageData, 0, row);
            }
        }
    }

    private onCaptureFinish(width: number, height: number, spriteFrame?: SpriteFrame, filePath?: string) {
        if (this.onCaptureComplete) {
            this.onCaptureComplete(true, filePath, spriteFrame, new Size(width, height));
        }
    }

    private onCaptureFailed() {
        this.onCaptureComplete(false, null, null, null);
    }

    private flipImageY(data: Uint8Array, width: number, height: number) {
        let pixels = new Uint8Array(width * height * 4);
        let rowBytes = width * 4;
        let maxRow = height - 1;
        for (let row = 0; row < height; row++) {
            let srow = maxRow - row;
            let start = srow * rowBytes;
            let reStart = row * rowBytes;
            for (let i = 0; i < rowBytes; i++) {
                pixels[i + reStart] = data[start + i];
            }
        }
        return pixels;
    }

    /**
     * @description 保存图片到本地
     * @param width 
     * @param height 
     * @param arrayBuffer 
     */
    private savaAsImage(width: number, height: number, arrayBuffer: Uint8Array, name: string) {
        if (sys.isBrowser) {
            this.createImageData(width, height, arrayBuffer);
            CanvasHelper.getInstance().saveAsPNG(this._canvas, width, height, name);
            this.onCaptureFinish(width, height);
        } else if (sys.isNative) {
            let filePath = native.fileUtils.getWritablePath() + name + ".png";
            let buffer = this._buffer;
            if(sys.os == "Android") {
                buffer = this.flipImageY(this._buffer, width, height);
            }
            native.saveImageData(buffer, width, height, filePath).then(() => {
                if (this.onCaptureComplete) {
                    // 用于测试图片是否正确保存到本地设备路径下
                    assetManager.loadRemote<ImageAsset>(filePath, (err, imageAsset) => {
                        if (err) {
                            console.log("show image error")
                            this.onCaptureFailed()
                        } else {
                            const spriteFrame = new SpriteFrame();
                            const texture = new Texture2D();
                            texture.image = imageAsset;
                            spriteFrame.texture = texture
                            spriteFrame.packable = false;
                            this.onCaptureFinish(width,height,spriteFrame, filePath);
                        }
                    });
                }
                console.log("save image data success, file: " + filePath);
            }).catch(() => {
                console.error("save image data failed!");
                this.onCaptureFailed()
            })
        } else if (sys.platform === sys.Platform.WECHAT_GAME) {
            this.createImageData(width, height, arrayBuffer);
            //@ts-ignore
            this._canvas.toTempFilePath({
                x: 0,
                y: 0,
                width: this._canvas.width,
                height: this._canvas.height,
                destWidth: this._canvas.width,
                destHeight: this._canvas.height,
                fileType: "png",
                success: (res: any) => {
                    //@ts-ignore
                    wx.showToast({
                        title: "capture success"
                    });

                    //@ts-ignore
                    wx.saveImageToPhotosAlbum({
                        filePath: res.tempFilePath,
                        success: (res: any) => {
                            //@ts-ignore              
                            wx.showToast({
                                title: "capture save photo album",
                            });
                        },
                        fail: () => {
                            //@ts-ignore              
                            wx.showToast({
                                title: "capture save failed",
                            });
                        }
                    })
                },
                fail: () => {
                    //@ts-ignore
                    wx.showToast({
                        title: "capture failed"
                    });
                }
            })
            this.onCaptureFinish(width, height);
        }
    }

    /**
     * @description 清除Canvas
     */
    private clearCanvas() {
        let ctx = this._canvas.getContext('2d');
        if (ctx) {
            ctx.clearRect(0, 0, this._canvas.width, this._canvas.height);
        }
    }

    private saveImage(cnode: Node, filename: string) {
        let trans = cnode.getComponent(UITransform);
        if (trans) {
            this.savaAsImage(trans.width, trans.height, this._buffer, filename)
        }
    }
}
