declare module 'react-image-crop' {
  export interface Crop {
    x: number;
    y: number;
    width: number;
    height: number;
    unit: 'px' | '%';
    aspect?: number;
  }
  export interface PercentCrop extends Crop {
    unit: '%';
  }
  export interface PixelCrop extends Crop {
    unit: 'px';
  }
  export const ReactCrop: any;
  export default ReactCrop;
}
declare module 'react-window';
