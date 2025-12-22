import { useState, useEffect, useRef } from 'react';
import { invoke, listen } from '../utils/webShim';
import { ImageFile, Invokes, Progress } from '../components/ui/AppProperties';

export function useThumbnails(imageList: Array<ImageFile>, setThumbnails: any) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Progress>({ completed: 0, total: 0 });
  const processedImageListKey = useRef<string | null>(null);

  useEffect(() => {
    const newKey =
      imageList && imageList.length > 0 ? JSON.stringify(imageList.map((img: ImageFile) => img.path).sort()) : '';

    if (newKey === processedImageListKey.current) {
      return;
    }

    processedImageListKey.current = newKey;

    if (!imageList || imageList.length === 0) {
      setThumbnails({});
      setLoading(false);
      setProgress({ completed: 0, total: 0 });
      return;
    }

    const imagePaths = imageList.map((img: ImageFile) => img.path);

    setThumbnails((prevThumbnails: Record<string, string>) => {
      const newPathSet = new Set(imagePaths);
      const nextThumbnails = { ...prevThumbnails };
      let hasChanges = false;

      Object.keys(nextThumbnails).forEach((path) => {
        if (!newPathSet.has(path)) {
          delete nextThumbnails[path];
          hasChanges = true;
        }
      });

      return hasChanges || Object.keys(nextThumbnails).length !== imagePaths.length ? nextThumbnails : prevThumbnails;
    });

    let unlistenComplete: any;
    let unlistenProgress: any;

    const setupListenersAndInvoke = async () => {
      setLoading(true);
      setProgress({ completed: 0, total: imagePaths.length });

      unlistenProgress = await listen('thumbnail-progress', (event: any) => {
        const { completed, total } = event.payload;
        setProgress({ completed, total });
      });

      unlistenComplete = await listen('thumbnail-generation-complete', () => {
        setLoading(false);
      });

      const unlistenGenerated = await listen('thumbnail-generated', (event: any) => {
        const { path, thumbnail } = event.payload;
        setThumbnails((prev: Record<string, string>) => ({
          ...prev,
          [path]: thumbnail,
        }));
      });

      try {
        await invoke(Invokes.GenerateThumbnailsProgressive, { paths: imagePaths });
      } catch (error) {
        console.error('Failed to invoke thumbnail generation:', error);
        setLoading(false);
      }

      // Cleanup extra listener
      return () => {
        unlistenGenerated();
      };
    };

    const cleanupPromise = setupListenersAndInvoke();

    setupListenersAndInvoke();

    return () => {
      if (unlistenComplete) {
        unlistenComplete();
      }
      if (unlistenProgress) {
        unlistenProgress();
      }
      cleanupPromise.then((cleanup: any) => {
        if (cleanup) cleanup();
      });
    };
  }, [imageList, setThumbnails]);

  return { loading, progress };
}
