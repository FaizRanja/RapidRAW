import React, { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import ReactCrop from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { Stage, Layer, Ellipse, Line, Transformer, Group, Circle, Rect } from 'react-konva';
import { PercentCrop, Crop } from 'react-image-crop';
import clsx from 'clsx';
import { Adjustments, AiPatch, Coord, MaskContainer } from '../../../utils/adjustments';
import { Mask, SubMask, SubMaskMode, ToolType } from '../right/Masks';
import { BrushSettings, SelectedImage } from '../../ui/AppProperties';
import { RenderSize } from '../../../hooks/useImageRenderSize';

interface CursorPreview {
  visible: boolean;
  x: number;
  y: number;
}

interface DrawnLine {
  brushSize: number;
  feather?: number;
  points: Array<Coord>;
  tool: ToolType;
}

interface ImageCanvasProps {
  activeAiPatchContainerId: string | null;
  activeAiSubMaskId: string | null;
  activeMaskContainerId: string | null;
  activeMaskId: string | null;
  adjustments: Adjustments;
  brushSettings: BrushSettings | null;
  crop: Crop | null;
  finalPreviewUrl: string | null;
  handleCropComplete(c: Crop, cp: PercentCrop): void;
  imageRenderSize: RenderSize;
  isAdjusting: boolean;
  isAiEditing: boolean;
  isCropping: boolean;
  isMaskControlHovered: boolean;
  isMasking: boolean;
  isStraightenActive: boolean;
  maskOverlayUrl: string | null;
  onGenerateAiMask(id: string | null, start: Coord, end: Coord): void;
  onQuickErase(subMaskId: string | null, startPoint: Coord, endpoint: Coord): void;
  onSelectAiSubMask(id: string | null): void;
  onSelectMask(id: string | null): void;
  onStraighten(val: number): void;
  selectedImage: SelectedImage;
  setCrop(crop: Crop, perfentCrop: PercentCrop): void;
  setIsMaskHovered(isHovered: boolean): void;
  showOriginal: boolean;
  transformedOriginalUrl: string | null;
  uncroppedAdjustedPreviewUrl: string | null;
  updateSubMask(id: string | null, subMask: Partial<SubMask>): void;
  fullResolutionUrl?: string | null;
  isFullResolution?: boolean;
  isLoadingFullRes?: boolean;
  isWbPickerActive?: boolean;
  onWbPicked?: () => void;
  setAdjustments(fn: (prev: Adjustments) => Adjustments): void;
}

interface ImageLayer {
  id: string;
  opacity: number;
  url: string | null;
}

interface MaskOverlay {
  adjustments: Adjustments;
  isToolActive: boolean;
  isSelected: boolean;
  onMaskMouseEnter(): void;
  onMaskMouseLeave(): void;
  onSelect(): void;
  onUpdate(id: string, subMask: Partial<SubMask>): void;
  scale: number;
  subMask: SubMask;
}

const ORIGINAL_LAYER = 'original';

function linesIntersect(eraserLine: DrawnLine, drawnLine: DrawnLine) {
  const threshold = eraserLine.brushSize / 2 + drawnLine.brushSize / 2;
  for (const p1 of eraserLine.points) {
    for (const p2 of drawnLine.points) {
      const distance = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
      if (distance < threshold) {
        return true;
      }
    }
  }
  return false;
}

const MaskOverlay = memo(
  ({
    adjustments,
    isToolActive,
    isSelected,
    onMaskMouseEnter,
    onMaskMouseLeave,
    onSelect,
    onUpdate,
    scale,
    subMask,
  }: MaskOverlay) => {
    const shapeRef = useRef<any>(null);
    const trRef = useRef<any>(null);

    const crop = adjustments.crop;
    const cropX = crop ? crop.x : 0;
    const cropY = crop ? crop.y : 0;
    const handleSelect = isToolActive ? undefined : onSelect;

    useEffect(() => {
      if (isSelected && trRef.current && shapeRef.current) {
        trRef.current?.nodes([shapeRef.current]);
        trRef.current?.getLayer().batchDraw();
      }
    }, [isSelected]);

    const handleRadialDrag = useCallback(
      (e: any) => {
        onUpdate(subMask.id, {
          parameters: {
            ...subMask.parameters,
            centerX: e.target.x() / scale + cropX,
            centerY: e.target.y() / scale + cropY,
          },
        });
      },
      [subMask.id, subMask.parameters, onUpdate, scale, cropX, cropY],
    );

    const handleRadialTransform = useCallback(() => {
      const node = shapeRef.current;
      if (!node) {
        return;
      }

      onUpdate(subMask.id, {
        parameters: {
          ...subMask.parameters,
          centerX: node.x() / scale + cropX,
          centerY: node.y() / scale + cropY,
          radiusX: (node.radiusX() * node.scaleX()) / scale,
          radiusY: (node.radiusY() * node.scaleY()) / scale,
          rotation: node.rotation(),
        },
      });
    }, [subMask.id, subMask.parameters, onUpdate, scale, cropX, cropY]);

    const handleRadialTransformEnd = useCallback(() => {
      const node = shapeRef.current;
      if (!node) {
        return;
      }

      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      node.scaleX(1);
      node.scaleY(1);

      onUpdate(subMask.id, {
        parameters: {
          ...subMask.parameters,
          centerX: node.x() / scale + cropX,
          centerY: node.y() / scale + cropY,
          radiusX: (node.radiusX() * scaleX) / scale,
          radiusY: (node.radiusY() * scaleY) / scale,
          rotation: node.rotation(),
        },
      });
    }, [subMask.id, subMask.parameters, onUpdate, scale, cropX, cropY]);

    const handleGroupDragEnd = (e: any) => {
      const group = e.target;
      const { startX, startY, endX, endY } = subMask.parameters;
      const dx = endX - startX;
      const dy = endY - startY;
      const centerX = startX + dx / 2;
      const centerY = startY + dy / 2;
      const groupX = (centerX - cropX) * scale;
      const groupY = (centerY - cropY) * scale;
      const moveX = group.x() - groupX;
      const moveY = group.y() - groupY;
      onUpdate(subMask.id, {
        parameters: {
          ...subMask.parameters,
          startX: startX + moveX / scale,
          startY: startY + moveY / scale,
          endX: endX + moveX / scale,
          endY: endY + moveY / scale,
        },
      });
    };

    const handlePointDrag = (e: any, point: string) => {
      const stage = e.target.getStage();
      const pointerPos = stage.getPointerPosition();
      if (!pointerPos) {
        return;
      }

      const newX = pointerPos.x / scale + cropX;
      const newY = pointerPos.y / scale + cropY;

      const newParams = { ...subMask.parameters };
      if (point === 'start') {
        newParams.startX = newX;
        newParams.startY = newY;
      } else {
        newParams.endX = newX;
        newParams.endY = newY;
      }
      onUpdate(subMask.id, { parameters: newParams });
    };

    const handleRangeDrag = (e: any) => {
      const newRange = Math.abs(e.target.y() / scale);
      onUpdate(subMask.id, {
        parameters: { ...subMask.parameters, range: newRange },
      });
    };

    if (!subMask.visible) {
      return null;
    }

    const commonProps = {
      dash: [4, 4],
      onClick: handleSelect,
      onTap: handleSelect,
      opacity: isSelected ? 1 : 0.7,
      stroke: isSelected ? '#0ea5e9' : subMask.mode === SubMaskMode.Subtractive ? '#f43f5e' : 'white',
      strokeScaleEnabled: false,
      strokeWidth: isSelected ? 3 : 2,
    };

    if (subMask.type === Mask.AiSubject) {
      const { startX, startY, endX, endY } = subMask.parameters;
      if (endX > startX && endY > startY) {
        return (
          <Rect
            height={(endY - startY) * scale}
            onMouseEnter={onMaskMouseEnter}
            onMouseLeave={onMaskMouseLeave}
            width={(endX - startX) * scale}
            x={(startX - cropX) * scale}
            y={(startY - cropY) * scale}
            {...commonProps}
          />
        );
      }
      return null;
    }

    if (subMask.type === Mask.Brush) {
      const { lines = [] } = subMask.parameters;
      return (
        <Group onClick={handleSelect} onTap={handleSelect}>
          {lines.map((line: DrawnLine, i: number) => (
            <Line
              hitStrokeWidth={line.brushSize * scale}
              key={i}
              lineCap="round"
              lineJoin="round"
              points={line.points.flatMap((p: Coord) => [(p.x - cropX) * scale, (p.y - cropY) * scale])}
              stroke="transparent"
              strokeScaleEnabled={false}
              tension={0.5}
            />
          ))}
        </Group>
      );
    }

    if (subMask.type === Mask.Radial) {
      const { centerX, centerY, radiusX, radiusY, rotation } = subMask.parameters;
      return (
        <>
          <Ellipse
            draggable
            onDragEnd={handleRadialDrag}
            onDragMove={handleRadialDrag}
            onMouseEnter={onMaskMouseEnter}
            onMouseLeave={onMaskMouseLeave}
            onTransform={handleRadialTransform}
            onTransformEnd={handleRadialTransformEnd}
            radiusX={radiusX * scale}
            radiusY={radiusY * scale}
            ref={shapeRef}
            rotation={rotation}
            x={(centerX - cropX) * scale}
            y={(centerY - cropY) * scale}
            {...commonProps}
          />
          {isSelected && (
            <Transformer
              boundBoxFunc={(oldBox, newBox) => newBox}
              onMouseEnter={onMaskMouseEnter}
              onMouseLeave={onMaskMouseLeave}
              ref={trRef}
            />
          )}
        </>
      );
    }

    if (subMask.type === Mask.Linear) {
      const { startX, startY, endX, endY, range = 50 } = subMask.parameters;
      const dx = endX - startX;
      const dy = endY - startY;
      const len = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const centerX = startX + dx / 2;
      const centerY = startY + dy / 2;
      const groupX = (centerX - cropX) * scale;
      const groupY = (centerY - cropY) * scale;
      const scaledLen = len * scale;
      const r = range * scale;

      const lineProps = {
        ...commonProps,
        strokeWidth: isSelected ? 2.5 : 2,
        dash: [6, 6],
        hitStrokeWidth: 20,
      };

      const perpendicularDragBoundFunc = function (this: any, pos: any) {
        const group = this.getParent();
        const transform = group.getAbsoluteTransform().copy();
        transform.invert();
        const localPos = transform.point(pos);
        const constrainedLocalPos = { x: 0, y: localPos.y };
        return group.getAbsoluteTransform().point(constrainedLocalPos);
      };

      return (
        <Group
          draggable={isSelected}
          onClick={handleSelect}
          onDragEnd={handleGroupDragEnd}
          onMouseEnter={(e: any) => {
            onMaskMouseEnter();
            const stage = e.target.getStage();
            if (stage) {
              stage.container().style.cursor = 'move';
            }
          }}
          onMouseLeave={(e: any) => {
            onMaskMouseLeave();
            const stage = e.target.getStage();
            if (stage) {
              stage.container().style.cursor = 'default';
            }
          }}
          onTap={handleSelect}
          rotation={(angle * 180) / Math.PI}
          x={groupX}
          y={groupY}
        >
          <Line points={[-5000, 0, 5000, 0]} {...lineProps} dash={[2, 3]} />
          <Line
            {...lineProps}
            dragBoundFunc={perpendicularDragBoundFunc}
            draggable={isSelected}
            onDragMove={handleRangeDrag}
            onDragEnd={(e: any) => {
              handleRangeDrag(e);
              e.cancelBubble = true;
            }}
            onMouseEnter={(e: any) => {
              e.target.getStage().container().style.cursor = 'row-resize';
              onMaskMouseEnter();
            }}
            onMouseLeave={(e: any) => {
              e.target.getStage().container().style.cursor = 'move';
              onMaskMouseLeave();
            }}
            points={[-scaledLen / 2, 0, scaledLen / 2, 0]}
            y={-r}
          />
          <Line
            {...lineProps}
            draggable={isSelected}
            dragBoundFunc={perpendicularDragBoundFunc}
            onDragEnd={(e: any) => {
              handleRangeDrag(e);
              e.cancelBubble = true;
            }}
            onDragMove={handleRangeDrag}
            onMouseEnter={(e: any) => {
              e.target.getStage().container().style.cursor = 'row-resize';
              onMaskMouseEnter();
            }}
            onMouseLeave={(e: any) => {
              e.target.getStage().container().style.cursor = 'move';
              onMaskMouseLeave();
            }}
            points={[-scaledLen / 2, 0, scaledLen / 2, 0]}
            y={r}
          />
          {isSelected && (
            <>
              <Circle
                draggable
                fill="#0ea5e9"
                onDragEnd={(e: any) => {
                  handlePointDrag(e, 'start');
                  e.cancelBubble = true;
                }}
                onDragMove={(e: any) => handlePointDrag(e, 'start')}
                onMouseEnter={(e: any) => {
                  e.target.getStage().container().style.cursor = 'grab';
                  onMaskMouseEnter();
                }}
                onMouseLeave={(e: any) => {
                  e.target.getStage().container().style.cursor = 'move';
                  onMaskMouseLeave();
                }}
                radius={8}
                stroke="white"
                strokeWidth={2}
                x={-scaledLen / 2}
                y={0}
              />
              <Circle
                draggable
                fill="#0ea5e9"
                onDragEnd={(e: any) => {
                  handlePointDrag(e, 'end');
                  e.cancelBubble = true;
                }}
                onDragMove={(e: any) => handlePointDrag(e, 'end')}
                onMouseEnter={(e: any) => {
                  e.target.getStage().container().style.cursor = 'grab';
                  onMaskMouseEnter();
                }}
                onMouseLeave={(e: any) => {
                  e.target.getStage().container().style.cursor = 'move';
                  onMaskMouseLeave();
                }}
                radius={8}
                stroke="white"
                strokeWidth={2}
                x={scaledLen / 2}
                y={0}
              />
            </>
          )}
        </Group>
      );
    }
    return null;
  },
);

const ImageCanvas = memo(
  ({
    activeAiPatchContainerId,
    activeAiSubMaskId,
    activeMaskContainerId,
    activeMaskId,
    adjustments,
    brushSettings,
    crop,
    finalPreviewUrl,
    handleCropComplete,
    imageRenderSize,
    isAdjusting,
    isAiEditing,
    isCropping,
    isMaskControlHovered,
    isMasking,
    isStraightenActive,
    maskOverlayUrl,
    onGenerateAiMask,
    onQuickErase,
    onSelectAiSubMask,
    onSelectMask,
    onStraighten,
    selectedImage,
    setCrop,
    setIsMaskHovered,
    showOriginal,
    transformedOriginalUrl,
    uncroppedAdjustedPreviewUrl,
    updateSubMask,
    fullResolutionUrl,
    isFullResolution,
    isLoadingFullRes,
    isWbPickerActive = false,
    onWbPicked,
    setAdjustments,
  }: ImageCanvasProps) => {
    const [isCropViewVisible, setIsCropViewVisible] = useState(false);
    const [layers, setLayers] = useState<Array<ImageLayer>>([]);
    const cropImageRef = useRef<HTMLImageElement>(null);
    const imagePathRef = useRef<string | null>(null);
    const latestEditedUrlRef = useRef<string | null>(null);

    const isDrawing = useRef(false);
    const currentLine = useRef<DrawnLine | null>(null);
    const [previewLine, setPreviewLine] = useState<DrawnLine | null>(null);
    const [cursorPreview, setCursorPreview] = useState<CursorPreview>({ x: 0, y: 0, visible: false });
    const [straightenLine, setStraightenLine] = useState<any>(null);
    const isStraightening = useRef(false);

    const activeContainer = useMemo(() => {
      if (isMasking) {
        return adjustments.masks.find((c: MaskContainer) => c.id === activeMaskContainerId);
      }
      if (isAiEditing) {
        return adjustments.aiPatches.find((p: AiPatch) => p.id === activeAiPatchContainerId);
      }
      return null;
    }, [
      adjustments.masks,
      adjustments.aiPatches,
      activeMaskContainerId,
      activeAiPatchContainerId,
      isMasking,
      isAiEditing,
    ]);

    const activeSubMask = useMemo(() => {
      if (!activeContainer) {
        return null;
      }
      if (isMasking) {
        return activeContainer.subMasks.find((m: SubMask) => m.id === activeMaskId);
      }
      if (isAiEditing) {
        return activeContainer.subMasks.find((m: SubMask) => m.id === activeAiSubMaskId);
      }
      return null;
    }, [activeContainer, activeMaskId, activeAiSubMaskId, isMasking, isAiEditing]);

    const isBrushActive = (isMasking || isAiEditing) && activeSubMask?.type === Mask.Brush;
    const isAiSubjectActive =
      (isMasking || isAiEditing) &&
      (activeSubMask?.type === Mask.AiSubject || activeSubMask?.type === Mask.QuickEraser);
    const isToolActive = isBrushActive || isAiSubjectActive;

    const sortedSubMasks = useMemo(() => {
      if (!activeContainer) {
        return [];
      }
      const activeId = isMasking ? activeMaskId : activeAiSubMaskId;
      const selectedMask = activeContainer.subMasks.find((m: SubMask) => m.id === activeId);
      const otherMasks = activeContainer.subMasks.filter((m: SubMask) => m.id !== activeId);
      return selectedMask ? [...otherMasks, selectedMask] : activeContainer.subMasks;
    }, [activeContainer, activeMaskId, activeAiSubMaskId, isMasking, isAiEditing]);

    useEffect(() => {
      const { path: currentImagePath, originalUrl, thumbnailUrl } = selectedImage;
      const imageChanged = currentImagePath !== imagePathRef.current;

      const currentPreviewUrl = showOriginal
        ? transformedOriginalUrl
        : isFullResolution && !isLoadingFullRes && fullResolutionUrl
        ? fullResolutionUrl
        : finalPreviewUrl;

      if (imageChanged) {
        imagePathRef.current = currentImagePath;
        latestEditedUrlRef.current = null;
        const initialUrl = thumbnailUrl || originalUrl;
        setLayers(initialUrl ? [{ id: initialUrl, url: initialUrl, opacity: 1 }] : []);
        return;
      }

      if (currentPreviewUrl && currentPreviewUrl !== latestEditedUrlRef.current) {
        latestEditedUrlRef.current = currentPreviewUrl;
        const img = new Image();
        img.src = currentPreviewUrl;
        img.onload = () => {
          if (img.src === latestEditedUrlRef.current) {
            setLayers((prev) => {
              if (prev.some((l) => l.id === img.src)) {
                return prev;
              }
              return [...prev, { id: img.src, url: img.src, opacity: 0 }];
            });
          }
        };
        return () => {
          img.onload = null;
        };
      }

      if (!currentPreviewUrl) {
        const initialUrl = originalUrl || thumbnailUrl;
        if (initialUrl && initialUrl !== latestEditedUrlRef.current) {
          latestEditedUrlRef.current = initialUrl;
          setLayers((prev) => {
            if (prev.length === 0) {
              return [{ id: initialUrl, url: initialUrl, opacity: 1 }];
            }
            return prev;
          });
        }
      }
    }, [
      selectedImage,
      finalPreviewUrl,
      fullResolutionUrl,
      transformedOriginalUrl,
      showOriginal,
      isFullResolution,
      isLoadingFullRes,
    ]);

    useEffect(() => {
      const layerToFadeIn = layers.find((l: ImageLayer) => l.opacity === 0);
      if (layerToFadeIn) {
        const timer = setTimeout(() => {
          setLayers((prev: Array<ImageLayer>) =>
            prev.map((l: ImageLayer) => (l.id === layerToFadeIn.id ? { ...l, opacity: 1 } : l)),
          );
        }, 10);

        return () => clearTimeout(timer);
      }
    }, [layers]);

    const handleTransitionEnd = useCallback((finishedId: string) => {
      setLayers((prev: Array<ImageLayer>) => {
        const finishedIndex = prev.findIndex((l) => l.id === finishedId);
        if (finishedIndex < 0 || prev.length <= 1) {
          return prev;
        }
        return prev.slice(finishedIndex);
      });
    }, []);

    useEffect(() => {
      if (isCropping && uncroppedAdjustedPreviewUrl) {
        const timer = setTimeout(() => setIsCropViewVisible(true), 10);
        return () => clearTimeout(timer);
      } else {
        setIsCropViewVisible(false);
      }
    }, [isCropping, uncroppedAdjustedPreviewUrl]);

    const handleWbClick = useCallback(
      (e: any) => {
        if (!isWbPickerActive || !finalPreviewUrl || !onWbPicked) return;

        const stage = e.target.getStage();
        const pointerPos = stage.getPointerPosition();
        if (!pointerPos) return;

        const x = (pointerPos.x - imageRenderSize.offsetX) / imageRenderSize.scale;
        const y = (pointerPos.y - imageRenderSize.offsetY) / imageRenderSize.scale;

        const imgWidth = imageRenderSize.width / imageRenderSize.scale;
        const imgHeight = imageRenderSize.height / imageRenderSize.scale;

        if (x < 0 || x > imgWidth || y < 0 || y > imgHeight) return;

        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.src = finalPreviewUrl;

        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;

          ctx.drawImage(img, 0, 0);

          const scaleX = img.width / imgWidth;
          const scaleY = img.height / imgHeight;
          const srcX = Math.floor(x * scaleX);
          const srcY = Math.floor(y * scaleY);

          const radius = 5;
          const startX = Math.max(0, srcX - radius);
          const startY = Math.max(0, srcY - radius);
          const endX = Math.min(img.width, srcX + radius + 1);
          const endY = Math.min(img.height, srcY + radius + 1);
          const w = endX - startX;
          const h = endY - startY;

          if (w <= 0 || h <= 0) return;

          const imageData = ctx.getImageData(startX, startY, w, h);
          const data = imageData.data;

          let rTotal = 0,
            gTotal = 0,
            bTotal = 0;
          let count = 0;

          for (let i = 0; i < data.length; i += 4) {
            rTotal += data[i];
            gTotal += data[i + 1];
            bTotal += data[i + 2];
            count++;
          }

          const avgR = rTotal / count;
          const avgG = gTotal / count;
          const avgB = bTotal / count;

          const linR = Math.pow(avgR / 255.0, 2.2);
          const linG = Math.pow(avgG / 255.0, 2.2);
          const linB = Math.pow(avgB / 255.0, 2.2);

          const sumRB = linR + linB;
          const deltaTemp = sumRB > 0.0001 ? ((linB - linR) / sumRB) * 125.0 : 0;

          const linM = sumRB / 2.0;
          const sumGM = linG + linM;
          const deltaTint = sumGM > 0.0001 ? ((linG - linM) / sumGM) * 400.0 : 0;

          setAdjustments((prev: Adjustments) => ({
            ...prev,
            temperature: Math.max(-100, Math.min(100, (prev.temperature || 0) + deltaTemp)),
            tint: Math.max(-100, Math.min(100, (prev.tint || 0) + deltaTint)),
          }));

          onWbPicked();
        };
      },
      [isWbPickerActive, finalPreviewUrl, imageRenderSize, onWbPicked, setAdjustments],
    );

    const handleMouseDown = useCallback(
      (e: any) => {
        if (isWbPickerActive) {
          e.evt.preventDefault();
          handleWbClick(e);
          return;
        }

        if (isToolActive) {
          e.evt.preventDefault();
          isDrawing.current = true;
          const stage = e.target.getStage();
          const pos = stage.getPointerPosition();
          if (!pos) {
            return;
          }

          const toolType = isAiSubjectActive ? ToolType.AiSeletor : ToolType.Brush;

          const newLine: DrawnLine = {
            brushSize: isBrushActive && brushSettings?.size ? brushSettings.size : 2,
            points: [pos],
            tool: toolType,
          };
          currentLine.current = newLine;
          setPreviewLine(newLine);
        } else {
          if (e.target === e.target.getStage()) {
            if (isMasking) {
              onSelectMask(null);
            }
            if (isAiEditing) {
              onSelectAiSubMask(null);
            }
          }
        }
      },
      [
        isWbPickerActive,
        handleWbClick,
        isBrushActive,
        isAiSubjectActive,
        brushSettings,
        onSelectMask,
        onSelectAiSubMask,
        isMasking,
        isAiEditing,
      ],
    );

    const handleMouseMove = useCallback(
      (e: any) => {
        if (isWbPickerActive) {
          return;
        }

        let pos;
        if (e && typeof e.target?.getStage === 'function') {
          const stage = e.target.getStage();
          pos = stage.getPointerPosition();
        } else if (e && e.clientX != null && e.clientY != null) {
          const stageEl = document.querySelector('.konvajs-content');
          if (stageEl) {
            const rect = stageEl.getBoundingClientRect();
            pos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
          }
        }

        if (isToolActive) {
          if (pos) {
            setCursorPreview({ x: pos.x, y: pos.y, visible: true });
          } else {
            setCursorPreview((p: CursorPreview) => ({ ...p, visible: false }));
          }
        }

        if (!isDrawing.current || !isToolActive) {
          return;
        }

        if (!pos) {
          return;
        }

        if (currentLine.current) {
          const updatedLine = {
            ...currentLine.current,
            points: [...currentLine.current.points, pos],
          };
          currentLine.current = updatedLine;
          setPreviewLine(updatedLine);
        }
      },
      [isToolActive, isWbPickerActive],
    );

    const handleMouseUp = useCallback(() => {
      if (!isDrawing.current || !currentLine.current) {
        return;
      }

      const wasDrawing = isDrawing.current;
      isDrawing.current = false;
      const line = currentLine.current;
      currentLine.current = null;
      setPreviewLine(null);

      if (!wasDrawing || !line) {
        return;
      }

      const { scale } = imageRenderSize;
      const cropX = adjustments.crop?.x || 0;
      const cropY = adjustments.crop?.y || 0;

      const activeId = isMasking ? activeMaskId : activeAiSubMaskId;

      if (activeSubMask?.type === Mask.AiSubject || activeSubMask?.type === Mask.QuickEraser) {
        const points = line.points;
        if (points.length > 1) {
          const xs = points.map((p: Coord) => p.x);
          const ys = points.map((p: Coord) => p.y);
          const minX = Math.min(...xs);
          const minY = Math.min(...ys);
          const maxX = Math.max(...xs);
          const maxY = Math.max(...ys);

          const startPoint = { x: minX / scale + cropX, y: minY / scale + cropY };
          const endPoint = { x: maxX / scale + cropX, y: maxY / scale + cropY };

          if (activeSubMask.type === Mask.QuickEraser && onQuickErase) {
            onQuickErase(activeId, startPoint, endPoint);
          } else if (activeSubMask.type === Mask.AiSubject && onGenerateAiMask) {
            onGenerateAiMask(activeId, startPoint, endPoint);
          }
        }
      } else if (isBrushActive) {
        const imageSpaceLine: DrawnLine = {
          brushSize: (brushSettings?.size ?? 0) / scale,
          feather: brushSettings?.feather ? brushSettings?.feather / 100 : 0,
          points: line.points.map((p: Coord) => ({
            x: p.x / scale + cropX,
            y: p.y / scale + cropY,
          })),
          tool: brushSettings?.tool ?? ToolType.Brush,
        };

        const existingLines = activeSubMask.parameters.lines || [];

        updateSubMask(activeId, {
          parameters: {
            ...activeSubMask.parameters,
            lines: [...existingLines, imageSpaceLine],
          },
        });
      }
    }, [
      activeAiSubMaskId,
      activeMaskId,
      activeSubMask,
      adjustments.crop,
      brushSettings,
      imageRenderSize.scale,
      isAiEditing,
      isBrushActive,
      isMasking,
      onGenerateAiMask,
      onQuickErase,
      updateSubMask,
    ]);

    const handleMouseEnter = useCallback(() => {
      if (isToolActive) {
        setCursorPreview((p: CursorPreview) => ({ ...p, visible: true }));
      }
    }, [isToolActive]);

    const handleMouseLeave = useCallback(() => {
      setCursorPreview((p: CursorPreview) => ({ ...p, visible: false }));
    }, []);

    useEffect(() => {
      if (!isToolActive) return;
      function onMove(e: MouseEvent) {
        handleMouseMove(e);
      }
      function onUp(e: MouseEvent) {
        handleMouseUp();
      }
      if (isDrawing.current) {
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
      }
    }, [isToolActive, handleMouseMove, handleMouseUp]);

    const handleStraightenMouseDown = (e: any) => {
      if (e.evt.button !== 0) {
        return;
      }

      isStraightening.current = true;
      const pos = e.target.getStage().getPointerPosition();
      setStraightenLine({ start: pos, end: pos });
    };

    const handleStraightenMouseMove = (e: any) => {
      if (!isStraightening.current) {
        return;
      }

      const pos = e.target.getStage().getPointerPosition();
      setStraightenLine((prev: any) => ({ ...prev, end: pos }));
    };

    const handleStraightenMouseUp = () => {
      if (!isStraightening.current) {
        return;
      }
      isStraightening.current = false;
      if (
        !straightenLine ||
        (straightenLine.start.x === straightenLine.end.x && straightenLine.start.y === straightenLine.start.y)
      ) {
        setStraightenLine(null);
        return;
      }

      const { start, end } = straightenLine;
      const { rotation = 0 } = adjustments;
      const theta_rad = (rotation * Math.PI) / 180;
      const cos_t = Math.cos(theta_rad);
      const sin_t = Math.sin(theta_rad);
      const width = uncroppedImageRenderSize?.width ?? 0;
      const height = uncroppedImageRenderSize?.height ?? 0;
      const cx = width / 2;
      const cy = height / 2;

      const unrotate = (p: Coord) => {
        const x = p.x - cx;
        const y = p.y - cy;
        return {
          x: cx + x * cos_t + y * sin_t,
          y: cy - x * sin_t + y * cos_t,
        };
      };

      const start_unrotated = unrotate(start);
      const end_unrotated = unrotate(end);
      const dx = end_unrotated.x - start_unrotated.x;
      const dy = end_unrotated.y - start_unrotated.y;
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      let targetAngle;

      if (angle > -45 && angle <= 45) {
        targetAngle = 0;
      } else if (angle > 45 && angle <= 135) {
        targetAngle = 90;
      } else if (angle > 135 || angle <= -135) {
        targetAngle = 180;
      } else {
        targetAngle = -90;
      }

      let correction = targetAngle - angle;
      if (correction > 180) {
        correction -= 360;
      }
      if (correction < -180) {
        correction += 360;
      }

      onStraighten(correction);
      setStraightenLine(null);
    };

    const handleStraightenMouseLeave = () => {
      if (isStraightening.current) {
        isStraightening.current = false;
        setStraightenLine(null);
      }
    };

    const cropPreviewUrl = uncroppedAdjustedPreviewUrl || selectedImage.originalUrl;
    const isContentReady = layers.length > 0 && layers.some((l) => l.url);

    const uncroppedImageRenderSize = useMemo<Partial<RenderSize> | null>(() => {
      if (!selectedImage?.width || !selectedImage?.height || !imageRenderSize?.width || !imageRenderSize?.height) {
        return null;
      }

      const viewportWidth = imageRenderSize.width + 2 * imageRenderSize.offsetX;
      const viewportHeight = imageRenderSize.height + 2 * imageRenderSize.offsetY;

      let uncroppedEffectiveWidth = selectedImage.width;
      let uncroppedEffectiveHeight = selectedImage.height;
      const orientationSteps = adjustments.orientationSteps || 0;
      if (orientationSteps === 1 || orientationSteps === 3) {
        [uncroppedEffectiveWidth, uncroppedEffectiveHeight] = [uncroppedEffectiveHeight, uncroppedEffectiveWidth];
      }

      if (uncroppedEffectiveWidth <= 0 || uncroppedEffectiveHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
        return null;
      }

      const scale = Math.min(viewportWidth / uncroppedEffectiveWidth, viewportHeight / uncroppedEffectiveHeight);

      const renderWidth = uncroppedEffectiveWidth * scale;
      const renderHeight = uncroppedEffectiveHeight * scale;

      return { width: renderWidth, height: renderHeight };
    }, [selectedImage?.width, selectedImage?.height, imageRenderSize, adjustments.orientationSteps]);

    const cropImageTransforms = useMemo(() => {
      const transforms = [`rotate(${adjustments.rotation || 0}deg)`];
      if (adjustments.flipHorizontal) {
        transforms.push('scaleX(-1)');
      }
      if (adjustments.flipVertical) {
        transforms.push('scaleY(-1)');
      }
      return transforms.join(' ');
    }, [adjustments.rotation, adjustments.flipHorizontal, adjustments.flipVertical]);

    // Calculate Temperature/Tint overlay color
    const tempTintOverlay = useMemo(() => {
      const { temperature = 0, tint = 0 } = adjustments;
      if (temperature === 0 && tint === 0) return null;

      // Temperature: Orange (positive) vs Blue (negative)
      // Tint: Magenta (positive) vs Green (negative)

      // We'll simplisticly mix two colors.
      // This is a rough approximation.
      let r = 0,
        g = 0,
        b = 0;
      let opacity = 0;

      // Normalize values -100 to 100 -> -1 to 1
      const t = temperature / 100; // +Orange / -Blue
      const tn = tint / 100; // +Magenta / -Green

      // Base contribution
      // Warm (Orange): R=255, G=160, B=0
      // Cool (Blue):   R=0,   G=100, B=255

      // Tint
      // Magenta: R=255, G=0, B=255
      // Green:   R=0,   G=255, B=0

      if (t > 0) {
        r += 255 * t;
        g += 160 * t;
        b += 0 * t;
        opacity += t;
      } else {
        r += 0 * -t;
        g += 100 * -t;
        b += 255 * -t;
        opacity += -t;
      }

      if (tn > 0) {
        r += 255 * tn;
        g += 0 * tn;
        b += 255 * tn;
        opacity += tn;
      } else {
        r += 0 * -tn;
        g += 255 * -tn;
        b += 0 * -tn;
        opacity += -tn;
      }

      // Average out if both are active (simple heuristic)
      const count = (t !== 0 ? 1 : 0) + (tn !== 0 ? 1 : 0);
      if (count > 0) {
        // Re-normalization isn't perfect here but works for visual "coating"
        // Actually, let's just use the max opacity and clamp the color sums
        opacity = Math.min(0.5, opacity / count); // Cap opacity so it doesn't obscure image
        r = Math.min(255, r);
        g = Math.min(255, g);
        b = Math.min(255, b);
      }

      return {
        backgroundColor: `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 1)`,
        opacity: Math.abs(opacity),
        mixBlendMode: 'overlay', // Soft light or overlay works well for tinting
        pointerEvents: 'none',
        position: 'absolute',
        inset: 0,
        zIndex: 10,
      } as const;
    }, [adjustments.temperature, adjustments.tint]);

    // Vignette Overlay
    const vignetteStyle = useMemo(() => {
      const { vignetteAmount = 0, vignetteMidpoint = 50, vignetteFeather = 50, vignetteRoundness = 0 } = adjustments;
      if (vignetteAmount === 0) return null;

      // Invert amount logic from LR style: Negative is dark corners (common), Positive is white corners.
      // Assuming standard "make it dark":
      // Actually, the app likely uses negative for dark, positive for white like Lightroom.
      // Let's assume user drags Left (-100) -> Dark vignette.

      const isDark = vignetteAmount < 0;
      const color = isDark ? '0,0,0' : '255,255,255';
      const opacity = Math.abs(vignetteAmount) / 100;

      // Midpoint: 0 (center) to 100 (edges). Default 50.
      // In CSS radial-gradient, the start position of the fade.
      const midpointPct = vignetteMidpoint + '%';

      // Feather: 0 (hard edge) to 100 (soft).
      // Controls the distance between start and end of gradient.
      // Simplified mapping.
      const featherVal = (100 - vignetteFeather) / 2; // Arbitrary scaler
      const endPct = Math.min(100, vignetteMidpoint + 50 + (100 - vignetteFeather)) + '%';

      // Roundness is hard to map perfectly to radial-gradient shape without detailed percentage tweaking.
      // We'll stick to a basic radial gradient.

      return {
        background: `radial-gradient(circle closest-corner at 50% 50%, rgba(${color},0) ${midpointPct}, rgba(${color},${opacity}) ${endPct})`,
        pointerEvents: 'none',
        position: 'absolute',
        inset: 0,
        zIndex: 11,
        mixBlendMode: isDark ? 'multiply' : 'screen',
      } as const;
    }, [
      adjustments.vignetteAmount,
      adjustments.vignetteMidpoint,
      adjustments.vignetteFeather,
      adjustments.vignetteRoundness,
    ]);

    // Grain Overlay - using a noise pattern data URI for simplicity
    const grainStyle = useMemo(() => {
      const { grainAmount = 0, grainSize = 25 } = adjustments;
      if (grainAmount === 0) return null;

      // This is a minimal SVG noise
      const noiseSvg = `<svg xmlns='http://www.w3.org/2000/svg' width='100' height='100'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='${
        0.5 + (100 - grainSize) / 200
      }' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)' opacity='${
        grainAmount / 100
      }'/></svg>`;
      const url = `url("data:image/svg+xml;utf8,${noiseSvg}")`;

      return {
        backgroundImage: url,
        pointerEvents: 'none',
        position: 'absolute',
        inset: 0,
        zIndex: 12,
        opacity: 0.5 + grainAmount / 200, // Base opacity
        mixBlendMode: 'overlay',
      } as const;
    }, [adjustments.grainAmount, adjustments.grainSize]);

    // Calculate Transform (Rotate/Flip)
    const imgTransform = useMemo(() => {
      const transforms = [];
      if (adjustments.rotation) {
        transforms.push(`rotate(${adjustments.rotation}deg)`);
      }
      // Process orientationSteps (90 degree increments)
      if (adjustments.orientationSteps) {
        transforms.push(`rotate(${adjustments.orientationSteps * 90}deg)`);
      }

      if (adjustments.flipHorizontal) {
        transforms.push('scaleX(-1)');
      }
      if (adjustments.flipVertical) {
        transforms.push('scaleY(-1)');
      }

      // Keep the GPU acceleration hack
      transforms.push('translateZ(0)');

      return transforms.join(' ');
    }, [adjustments.rotation, adjustments.orientationSteps, adjustments.flipHorizontal, adjustments.flipVertical]);

    // Calculate Crop (Clip-Path)
    // We assume adjustments.crop is relative to the "oriented" dimensions
    // (swapped if 90/270 deg) because CropPanel logic works that way.
    const imgClipPath = useMemo(() => {
      if (!adjustments.crop || !selectedImage?.width || !selectedImage?.height) return 'none';

      // Base dimensions depend on orientation
      const steps = adjustments.orientationSteps || 0;
      const isSwapped = steps === 1 || steps === 3;
      const baseW = isSwapped ? selectedImage.height : selectedImage.width;
      const baseH = isSwapped ? selectedImage.width : selectedImage.height;

      const { x, y, width, height } = adjustments.crop;

      // Convert to percentages
      const top = (y / baseH) * 100;
      const left = (x / baseW) * 100;
      const bottom = 100 - ((y + height) / baseH) * 100;
      const right = 100 - ((x + width) / baseW) * 100;

      return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
    }, [adjustments.crop, adjustments.orientationSteps, selectedImage?.width, selectedImage?.height]);

    // --- Curve / SVG Filter Generator ---

    // Simple Monotone Cubic Spline Interpolation for smooth curves
    const interpolateCurve = (points: Coord[]): number[] => {
      // Safety check
      if (!points || points.length === 0) {
        // Return linear identity if no points
        const identity = new Array(256);
        for (let i = 0; i < 256; i++) identity[i] = i / 255;
        return identity;
      }

      // Clone to avoid mutating prop
      const sortedPoints = [...points].sort((a, b) => a.x - b.x);

      // Ensure endpoints 0,0 and 255,255 exist (or extend)
      if (sortedPoints[0].x > 0) sortedPoints.unshift({ x: 0, y: 0 });
      if (sortedPoints[sortedPoints.length - 1].x < 255) sortedPoints.push({ x: 255, y: 255 });

      const n = sortedPoints.length;
      const x = sortedPoints.map((p) => p.x);
      const y = sortedPoints.map((p) => p.y);
      const m = new Array(n).fill(0);
      const dx = new Array(n - 1).fill(0);
      const dy = new Array(n - 1).fill(0);
      const slope = new Array(n - 1).fill(0);

      for (let i = 0; i < n - 1; i++) {
        dx[i] = x[i + 1] - x[i];
        dy[i] = y[i + 1] - y[i];
        slope[i] = dx[i] !== 0 ? dy[i] / dx[i] : 0;
      }

      // Calculate slopes
      m[0] = slope[0];
      m[n - 1] = slope[n - 2];
      for (let i = 0; i < n - 1; i++) {
        if (slope[i] * slope[i - 1] <= 0) m[i] = 0;
        else {
          m[i] = (slope[i] + slope[i - 1]) / 2;
        }
      }

      const table = [];
      let currentPoint = 0;

      for (let i = 0; i <= 255; i++) {
        // Find segment
        while (currentPoint < n - 1 && x[currentPoint + 1] < i) {
          currentPoint++;
        }

        const p0 = sortedPoints[currentPoint];
        const p1 = sortedPoints[currentPoint + 1];

        if (!p1) {
          table.push(y[n - 1] / 255);
          continue;
        }

        const h = p1.x - p0.x;
        const t = h !== 0 ? (i - p0.x) / h : 0;
        const t2 = t * t;
        const t3 = t2 * t;

        // Hermite basis functions
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;

        // Interpolated y
        let iy = h00 * p0.y + h10 * h * m[currentPoint] + h01 * p1.y + h11 * h * m[currentPoint + 1];
        iy = Math.max(0, Math.min(255, iy));
        table.push(iy / 255);
      }
      return table;
    };

    // Generate unique ID for this instance to avoid filter conflicts
    const filterId = useMemo(() => `rapidraw-filter-${Math.random().toString(36).substr(2, 9)}`, []);

    const svgFilterData = useMemo(() => {
      // Curve Calculation
      const {
        curves = { red: [], green: [], blue: [], luma: [] }, // Default empty if undefined

        highlights = 0,
        shadows = 0,
        whites = 0,
        blacks = 0,
        sharpness = 0,
        structure = 0,
        chromaticAberrationRedCyan = 0,
        chromaticAberrationBlueYellow = 0,
        colorGrading,
        colorCalibration,
      } = adjustments;

      // --- Color Grading Helper ---
      // We need to convert HSL (Hue, Sat, Lum) to RGB offsets for shadows/mids/highs
      const hslToRgbDiff = (h: number, s: number, l: number) => {
        // Simple approximation: HSL to RGB, then subtract neutral gray to get "diff"
        // h: 0-360, s: 0-1, l: -1 to 1 (luminance offset)
        if (s === 0) return { r: 0, g: 0, b: 0 };

        const c = (1 - Math.abs(2 * 0.5 - 1)) * s; // Fixed L=0.5 for pure color extraction
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = 0.5 - c / 2;

        let r = 0,
          g = 0,
          b = 0;

        if (0 <= h && h < 60) {
          r = c;
          g = x;
          b = 0;
        } else if (60 <= h && h < 120) {
          r = x;
          g = c;
          b = 0;
        } else if (120 <= h && h < 180) {
          r = 0;
          g = c;
          b = x;
        } else if (180 <= h && h < 240) {
          r = 0;
          g = x;
          b = c;
        } else if (240 <= h && h < 300) {
          r = x;
          g = 0;
          b = c;
        } else if (300 <= h && h < 360) {
          r = c;
          g = 0;
          b = x;
        }

        // Returns the color "push" vector
        return { r: r + m - 0.5, g: g + m - 0.5, b: b + m - 0.5 };
      };

      const shad = colorGrading?.shadows || { hue: 0, saturation: 0, luminance: 0 };
      const mid = colorGrading?.midtones || { hue: 0, saturation: 0, luminance: 0 };
      const high = colorGrading?.highlights || { hue: 0, saturation: 0, luminance: 0 };
      const blending = (colorGrading?.blending || 50) / 100;
      const balance = (colorGrading?.balance || 0) / 100; // -1 to 1

      const shadRGB = hslToRgbDiff(shad.hue, shad.saturation, 0);
      const midRGB = hslToRgbDiff(mid.hue, mid.saturation, 0);
      const highRGB = hslToRgbDiff(high.hue, high.saturation, 0);

      const shadowTint = colorCalibration?.shadowsTint || 0; // -100 to 100

      // Debug checking for NaN sources
      if (Number.isNaN(shadRGB.r) || Number.isNaN(balance)) {
        console.error('SVG Filter Params NaN:', { shadRGB, midRGB, highRGB, balance, shadowsTint, colorGrading });
      }

      // Base Arrays (Linear)
      // We start with the User Defined Curve Points
      // And we combine "Basic" tweaks (Highlights/Shadows) by modifying the curve logic slightly
      // Or simpler: Just calculate the user curve, then apply highlights/shadows math to the table.

      const applyTone = (val: number, channel: 'r' | 'g' | 'b') => {
        let v = val;
        // Blacks: offset low end
        if (blacks !== 0) v += (blacks / 100) * (1 - v) * 0.2;
        // Whites: offset high end
        if (whites !== 0) v += (whites / 100) * v * 0.2;

        // basic tonality
        if (shadows !== 0) {
          const s = shadows / 100;
          if (v < 0.5) v += s * (0.5 - Math.abs(v - 0.25) * 2) * 0.3;
        }

        if (highlights !== 0) {
          const h = highlights / 100;
          if (v > 0.5) v += h * (0.5 - Math.abs(v - 0.75) * 2) * 0.3;
        }

        // --- Color Grading Application ---
        // Range definitions (approximate)
        // Shadows: 0 - 0.5 (Peak 0)
        // Highlights: 0.5 - 1 (Peak 1)
        // Midtones: 0.2 - 0.8 (Peak 0.5)

        // Balance shifts the center point.
        const balOffset = balance * 0.2;

        // Weights
        const lum = v;

        // Shadows Weight: 1 at 0, 0 at ~0.5 + balance
        let wS = Math.max(0, 1 - lum / (0.5 + balOffset));
        wS = wS * wS; // squared for falloff

        // Highlights Weight: 1 at 1, 0 at ~0.5 + balance
        let wH = Math.max(0, (lum - (0.5 + balOffset)) / (1 - (0.5 + balOffset)));
        wH = wH * wH;

        // Midtones
        let wM = 1 - Math.abs(lum - 0.5) * 2;
        wM = Math.max(0, wM);

        // Apply
        let gradeOffset = 0;
        if (channel === 'r') gradeOffset = shadRGB.r * wS + midRGB.r * wM + highRGB.r * wH;
        if (channel === 'g') gradeOffset = shadRGB.g * wS + midRGB.g * wM + highRGB.g * wH;
        if (channel === 'b') gradeOffset = shadRGB.b * wS + midRGB.b * wM + highRGB.b * wH;

        v += gradeOffset * 2; // *2 to make it more visible

        // --- Color Calibration (Shadow Tint only) ---
        if (channel === 'g' && shadowTint !== 0 && v < 0.5) {
          // Green-Magenta shift in shadows
          // +Tint = Magenta (Remove Green), -Tint = Green (Add Green)
          // Applied to G channel
          const tintStr = shadowTint / 100;
          // Mask to shadows
          const tintWeight = Math.max(0, 1 - v * 2);
          v -= tintStr * tintWeight * 0.1;
        }

        return Math.max(0, Math.min(1, v));
      };

      const lumaTable = interpolateCurve([...(curves?.luma || [])]);
      const mapCurve = (channelTable: number[]) => {
        return channelTable.map((val) => {
          // Map 0-1 value to 0-255 index
          const index = Math.max(0, Math.min(255, Math.round(val * 255)));
          return lumaTable[index];
        });
      };

      const redTable = mapCurve(interpolateCurve([...(curves?.red || [])]))
        .map((v) => applyTone(v, 'r'))
        .join(' ');
      const greenTable = mapCurve(interpolateCurve([...(curves?.green || [])]))
        .map((v) => applyTone(v, 'g'))
        .join(' ');
      const blueTable = mapCurve(interpolateCurve([...(curves?.blue || [])]))
        .map((v) => applyTone(v, 'b'))
        .join(' ');

      // Sharpen Kernel
      let sharpenEl = null;
      let totalSharpness = sharpness + structure;
      if (totalSharpness > 0) {
        const s = totalSharpness / 20;
        const k = -s;
        const c = 1 + 4 * s;
        // Basic sharpen kernel - can introduce artifacts if too strong
        const matrix = `0 ${k} 0 ${k} ${c} ${k} 0 ${k} 0`;
        sharpenEl = <feConvolveMatrix order="3" kernelMatrix={matrix} preserveAlpha="true" result="sharpened" />;
      }

      // Chromatic Aberration
      let chromAbEl = null;
      if (Math.abs(chromaticAberrationRedCyan) > 0 || Math.abs(chromaticAberrationBlueYellow) > 0) {
        const dxR = chromaticAberrationRedCyan / 5;
        const dxB = chromaticAberrationBlueYellow / 5;

        // We need to split channels from curvesResult (or sharpened if applied first, but we apply CA first usually for simplicity here)
        // Actually best order: Curves -> CA -> Sharpen

        chromAbEl = (
          <>
            <feOffset dx={dxR} dy={0} in="curvesResult" result="redShift" />
            <feOffset dx={dxB} dy={0} in="curvesResult" result="blueShift" />

            <feColorMatrix type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" in="redShift" result="R" />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"
              in="curvesResult"
              result="G"
            />
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0"
              in="blueShift"
              result="B"
            />

            <feComposite operator="arithmetic" k1="0" k2="1" k3="1" k4="0" in="R" in2="G" result="RG" />
            <feComposite operator="arithmetic" k1="0" k2="1" k3="1" k4="0" in="RG" in2="B" result="RGB" />
          </>
        );
      }

      return { redTable, greenTable, blueTable, sharpenEl, chromAbEl, hasCA: !!chromAbEl, filterId };
    }, [
      adjustments.curves,
      adjustments.highlights,
      adjustments.shadows,
      adjustments.whites,
      adjustments.blacks,
      adjustments.sharpness,
      adjustments.structure,
      adjustments.colorGrading,
      adjustments.colorCalibration,
      adjustments.chromaticAberrationRedCyan,
      adjustments.chromaticAberrationBlueYellow,
      filterId,
    ]);

    const imageFilters = useMemo(() => {
      const {
        brightness = 0,
        contrast = 0,
        exposure = 0,
        saturation = 0,
        enableNegativeConversion = false,
        sharpness = 0,
        vibrance = 0,
        clarity = 0,
        dehaze = 0,
      } = adjustments;

      // Brightness/Exposure:
      // Dehaze darkens image slightly (-dehaze/400)
      const bVal = 1 + brightness / 100 + exposure / 2 - dehaze / 400;

      // Contrast:
      // Add Clarity and Dehaze to contrast (scaled down)
      // Clarity is usually local contrast, but global contrast is a fair shim.
      const contrastVal = 1 + (contrast + clarity / 2 + dehaze / 2) / 100;

      // Saturation:
      const saturationVal = 1 + (saturation + vibrance) / 100;

      // Blur (negative sharpness)
      const blurVal = sharpness < 0 ? Math.abs(sharpness) / 20 : 0;

      const filters = [
        `brightness(${Math.max(0, bVal)})`,
        `contrast(${Math.max(0, contrastVal)})`,
        `saturate(${Math.max(0, saturationVal)})`,
        `blur(${blurVal}px)`,
      ];

      // Append our custom SVG filter
      filters.push(`url('#${filterId}')`);

      if (enableNegativeConversion) {
        filters.push('invert(1)');
      }

      return filters.join(' ');
    }, [
      adjustments.brightness,
      adjustments.contrast,
      adjustments.exposure,
      adjustments.saturation,
      adjustments.vibrance,
      adjustments.sharpness,
      adjustments.enableNegativeConversion,
      filterId,
      // Re-trigger if curve changes (even if handled in SVG, the component re-renders)
    ]);

    return (
      <div className="relative" style={{ width: '100%', height: '100%' }}>
        {/* Helper SVG for Advanced Filters */}
        <svg
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
            top: 0,
            left: 0,
            zIndex: -1,
            opacity: 0, // Keep it visually hidden but layout present
          }}
        >
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%" primitiveUnits="userSpaceOnUse">
            {/* 1. Curves & Tones */}
            <feComponentTransfer in="SourceGraphic" result="curvesResult">
              <feFuncR type="table" tableValues={svgFilterData.redTable} />
              <feFuncG type="table" tableValues={svgFilterData.greenTable} />
              <feFuncB type="table" tableValues={svgFilterData.blueTable} />
            </feComponentTransfer>

            {/* 2. Chromatic Aberration */}
            {svgFilterData.hasCA ? svgFilterData.chromAbEl : null}

            {/* 3. Sharpening */}
            {svgFilterData.sharpenEl ? (
              React.cloneElement(svgFilterData.sharpenEl, { in: svgFilterData.hasCA ? 'RGB' : 'curvesResult' })
            ) : svgFilterData.hasCA ? (
              <feMerge>
                <feMergeNode in="RGB" />
              </feMerge>
            ) : (
              <feMerge>
                <feMergeNode in="curvesResult" />
              </feMerge>
            )}
          </filter>
        </svg>

        <div
          className="absolute inset-0 w-full h-full transition-opacity duration-200 flex items-center justify-center"
          style={{
            opacity: isCropViewVisible ? 0 : 1,
            pointerEvents: isCropViewVisible ? 'none' : 'auto',
          }}
        >
          <div
            className={clsx(isAdjusting && !showOriginal ? 'opacity-90' : 'opacity-100')}
            style={{
              height: '100%',
              opacity: isContentReady ? 1 : 0,
              position: 'relative',
              width: '100%',
            }}
          >
            <div className="absolute inset-0 w-full h-full">
              {layers.map((layer: ImageLayer) =>
                layer.url ? (
                  <img
                    alt={layer.id === ORIGINAL_LAYER ? ' ' : ' '}
                    className="absolute inset-0 w-full h-full object-contain"
                    key={layer.id}
                    onTransitionEnd={() => handleTransitionEnd(layer.id)}
                    src={layer.url}
                    style={{
                      opacity: layer.opacity,
                      transition: 'opacity 150ms ease-in-out',
                      willChange: 'opacity, transform',
                      imageRendering: 'high-quality',
                      WebkitImageRendering: 'high-quality',
                      transform: imgTransform,
                      transformOrigin: 'center center',
                      backfaceVisibility: 'hidden',
                      filter: imageFilters,
                      clipPath: imgClipPath,
                      WebkitClipPath: imgClipPath,
                    }}
                  />
                ) : null,
              )}

              {/* Adjustment Overlays */}
              {tempTintOverlay && <div style={tempTintOverlay} />}
              {vignetteStyle && <div style={vignetteStyle} />}
              {grainStyle && <div style={grainStyle} />}

              {(isMasking || isAiEditing) && maskOverlayUrl && (
                <img
                  alt="Mask Overlay"
                  className="absolute object-contain pointer-events-none"
                  src={maskOverlayUrl}
                  decoding="async"
                  style={{
                    height: `${imageRenderSize.height}px`,
                    left: `${imageRenderSize.offsetX}px`,
                    opacity: showOriginal || isMaskControlHovered ? 0 : 1,
                    top: `${imageRenderSize.offsetY}px`,
                    transition: 'opacity 125ms ease-in-out',
                    width: `${imageRenderSize.width}px`,
                  }}
                />
              )}
            </div>
          </div>

          <Stage
            height={imageRenderSize.height}
            onMouseDown={handleMouseDown}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            style={{
              cursor: isWbPickerActive ? 'crosshair' : isToolActive ? 'crosshair' : 'default',
              left: `${imageRenderSize.offsetX}px`,
              opacity: showOriginal ? 0 : 1,
              pointerEvents: showOriginal ? 'none' : 'auto',
              position: 'absolute',
              top: `${imageRenderSize.offsetY}px`,
              zIndex: 4,
            }}
            width={imageRenderSize.width}
          >
            <Layer>
              {(isMasking || isAiEditing) &&
                activeContainer &&
                sortedSubMasks.map((subMask: SubMask) => (
                  <MaskOverlay
                    adjustments={adjustments}
                    isSelected={subMask.id === (isMasking ? activeMaskId : activeAiSubMaskId)}
                    isToolActive={isToolActive}
                    key={subMask.id}
                    onMaskMouseEnter={() => !isToolActive && setIsMaskHovered(true)}
                    onMaskMouseLeave={() => !isToolActive && setIsMaskHovered(false)}
                    onSelect={() => (isMasking ? onSelectMask(subMask.id) : onSelectAiSubMask(subMask.id))}
                    onUpdate={updateSubMask}
                    scale={imageRenderSize.scale}
                    subMask={subMask}
                  />
                ))}
              {previewLine && (
                <Line
                  dash={previewLine.tool === ToolType.AiSeletor ? [4, 4] : undefined}
                  lineCap="round"
                  lineJoin="round"
                  listening={false}
                  opacity={0.8}
                  points={previewLine.points.flatMap((p: Coord) => [p.x, p.y])}
                  stroke={previewLine.tool === ToolType.Eraser ? '#f43f5e' : '#0ea5e9'}
                  strokeWidth={previewLine.tool === ToolType.AiSeletor ? 2 : previewLine.brushSize}
                  tension={0.5}
                />
              )}
              {isBrushActive && cursorPreview.visible && (
                <Circle
                  listening={false}
                  perfectDrawEnabled={false}
                  stroke={brushSettings?.tool === ToolType.Eraser ? '#f43f5e' : '#0ea5e9'}
                  radius={brushSettings?.size ? brushSettings.size / 2 : 0}
                  strokeWidth={1}
                  x={cursorPreview.x}
                  y={cursorPreview.y}
                />
              )}
            </Layer>
          </Stage>
        </div>

        <div
          className="absolute inset-0 w-full h-full flex items-center justify-center transition-opacity duration-200"
          style={{
            opacity: isCropViewVisible ? 1 : 0,
            pointerEvents: isCropViewVisible ? 'auto' : 'none',
          }}
        >
          {cropPreviewUrl && uncroppedImageRenderSize && (
            <div
              style={{
                height: uncroppedImageRenderSize.height,
                position: 'relative',
                width: uncroppedImageRenderSize.width,
              }}
            >
              <ReactCrop
                aspect={adjustments.aspectRatio}
                crop={crop}
                onChange={setCrop}
                onComplete={handleCropComplete}
                ruleOfThirds={!isStraightenActive}
              >
                <img
                  alt="Crop preview"
                  ref={cropImageRef}
                  src={cropPreviewUrl}
                  style={{
                    display: 'block',
                    width: `${uncroppedImageRenderSize.width}px`,
                    height: `${uncroppedImageRenderSize.height}px`,
                    objectFit: 'contain',
                    transform: cropImageTransforms,
                  }}
                />
              </ReactCrop>

              {isStraightenActive && (
                <Stage
                  height={uncroppedImageRenderSize.height}
                  onMouseDown={handleStraightenMouseDown}
                  onMouseLeave={handleStraightenMouseLeave}
                  onMouseMove={handleStraightenMouseMove}
                  onMouseUp={handleStraightenMouseUp}
                  style={{ position: 'absolute', top: 0, left: 0, zIndex: 10, cursor: 'crosshair' }}
                  width={uncroppedImageRenderSize.width}
                >
                  <Layer>
                    {straightenLine && (
                      <Line
                        dash={[4, 4]}
                        listening={false}
                        points={[
                          straightenLine.start.x,
                          straightenLine.start.y,
                          straightenLine.end.x,
                          straightenLine.end.y,
                        ]}
                        stroke="#0ea5e9"
                        strokeWidth={2}
                      />
                    )}
                  </Layer>
                </Stage>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
);

export default ImageCanvas;
