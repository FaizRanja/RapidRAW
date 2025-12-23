export const dirParams = new Map<string, FileSystemDirectoryHandle>();
export const fileParams = new Map<string, string>(); // Store path -> handle mapping
// Store the root directory handle separately
let rootDirectoryHandle: FileSystemDirectoryHandle | null = null;
// Store the active image path needed for preview generation where path isn't passed explicitly
let activeImagePath: string | null = null;

const eventListeners = new Map<string, Set<(payload: any) => void>>();

const emit = (event: string, payload: any) => {
  const handlers = eventListeners.get(event);
  if (handlers) {
    handlers.forEach(handler => handler({ event, payload }));
  }
};

const getHandleFromPath = async (path: string): Promise<FileSystemFileHandle | null> => {
  if (!rootDirectoryHandle) return null;
  try {
    const pathParts = path.split('/').filter(p => p);
    // Remove filename
    const fileName = pathParts.pop();
    if (!fileName) return null;
    
    let currentHandle = rootDirectoryHandle;
    for (const part of pathParts) {
       currentHandle = await currentHandle.getDirectoryHandle(part);
    }
    return await currentHandle.getFileHandle(fileName);
  } catch (e) {
    console.error(`Error getting handle for ${path}`, e);
    return null;
  }
};

// Stateful storage for presets (in-memory only for this session)
let mockPresets: any[] = [];

export const invoke = async <T = any>(command: string, args?: any): Promise<T> => {
  console.log(`[WebShim] invoke: ${command}`, args);
  
  // ... existing mock handlers ...

  if (command === 'load_presets') {
      return [...mockPresets] as any;
  }
  
  if (command === 'save_presets') {
      console.log('[WebShim] save_presets', args);
      // args.presets contains the full new list of presets
      if (args && args.presets) {
          mockPresets = args.presets;
      }
      return true as any;
  }
  
  if (command === 'handle_import_presets_from_file') {
      console.log('[WebShim] handle_import_presets_from_file', args);
      const filePath = args.filePath;
      
      let importedPresets: any[] = [];
      
      // Try to read from our simulated file system
      if (fileContentMap.has(filePath)) {
          try {
              const content = fileContentMap.get(filePath)!;
              const json = JSON.parse(content);
              // Rust struct PresetFile { presets: Vec<PresetItem> }
              if (json.presets && Array.isArray(json.presets)) {
                  importedPresets = json.presets;
              } else {
                  console.warn('[WebShim] Invalid preset file format', json);
              }
          } catch (e) {
              console.error('[WebShim] Failed to parse imported file', e);
          }
      } else {
          // Fallback simulation if file content is missing (e.g. from prompt)
           console.log('[WebShim] content not found in map, using simulation fallback');
           importedPresets = [{
              preset: {
                  id: crypto.randomUUID(),
                  name: 'Imported Preset ' + (mockPresets.length + 1),
                  adjustments: { saturation: 1.5, contrast: 1.2, brightness: 1.1 }
              }
          }];
      }
      
      // Merge logic from Rust (file_management.rs)
      const currentNames = new Set(mockPresets.map(p => p.preset ? p.preset.name : p.folder.name));
      
      for (const item of importedPresets) {
          // Generate new IDs
          if (item.preset) {
              item.preset.id = crypto.randomUUID();
              let newName = item.preset.name;
              let counter = 1;
              while (currentNames.has(newName)) {
                  newName = `${item.preset.name} (${counter})`;
                  counter++;
              }
              item.preset.name = newName;
              currentNames.add(newName);
              mockPresets.push(item);
          } else if (item.folder) {
               item.folder.id = crypto.randomUUID();
               // Should also re-ID children
               if (item.folder.children) {
                   item.folder.children.forEach((child: any) => {
                       if (child.preset) child.preset.id = crypto.randomUUID();
                   });
               }
               
               let newName = item.folder.name;
               let counter = 1;
               while (currentNames.has(newName)) {
                   newName = `${item.folder.name} (${counter})`;
                   counter++;
               }
               item.folder.name = newName;
               currentNames.add(newName);
               mockPresets.push(item);
          }
      }
      
      return [...mockPresets] as any;
  }

  if (command === 'handle_import_legacy_presets_from_file') {
       console.log('[WebShim] Importing legacy preset fake');
       const newPreset = {
          preset: {
              id: crypto.randomUUID(),
              name: 'Legacy Import ' + (mockPresets.length + 1),
              adjustments: { saturation: -1 }
          }
      };
      mockPresets = [...mockPresets, newPreset];
      return [...mockPresets] as any;
  }

  
  if (command === 'get_folder_tree') {
    const path = args.path || '/';
    console.log(`Getting folder tree for path: ${path}`);
    
    let handle: FileSystemDirectoryHandle;
    
    if (path === '/') {
      if (!rootDirectoryHandle) {
        console.warn('No root directory selected');
        return { path: '/', name: 'Root', children: [] } as any;
      }
      handle = rootDirectoryHandle;
    } else {
      // For subdirectories, we need to navigate from root
      const pathParts = path.split('/').filter(p => p);
      handle = rootDirectoryHandle!;
      
      try {
        for (const part of pathParts) {
          handle = await handle.getDirectoryHandle(part);
        }
      } catch (error) {
        console.error(`Error navigating to path ${path}:`, error);
        return { path, name: path.split('/').pop() || path, children: [] } as any;
      }
    }
    
    const children = [];
    try {
      for await (const entry of handle.values()) {
        if (entry.kind === 'directory') {
          const entryPath = path === '/' ? `/${entry.name}` : `${path}/${entry.name}`;
          children.push({
            name: entry.name,
            path: entryPath,
            kind: 'directory',
            children: []
          });
        }
      }
    } catch (error) {
      console.error('Error reading directory:', error);
    }
    
    return { 
      path, 
      name: path === '/' ? (handle.name || 'Root') : handle.name, 
      children 
    } as any;
  }
  
  if (command === 'load_settings') {
    return {
      theme: 'dark',
      copyPasteSettings: {
        mode: 'merge',
        includedAdjustments: ['exposure', 'contrast']
      },
    } as any;
  }
  
  if (command === 'list_images_in_dir') {
    const path = args.path || '/';
    console.log(`Listing images in directory: ${path}`);
    
    let handle: FileSystemDirectoryHandle;
    
    if (path === '/') {
      if (!rootDirectoryHandle) {
        console.warn('No root directory selected');
        return [] as any;
      }
      handle = rootDirectoryHandle;
    } else {
      // Navigate to subdirectory
      const pathParts = path.split('/').filter(p => p);
      handle = rootDirectoryHandle!;
      
      try {
        for (const part of pathParts) {
          handle = await handle.getDirectoryHandle(part);
        }
      } catch (error) {
        console.error(`Error navigating to path ${path}:`, error);
        return [] as any;
      }
    }
    
    const images = [];
    try {
      for await (const entry of handle.values()) {
        if (entry.kind === 'file') {
          const fileHandle = entry as FileSystemFileHandle;
          const fileName = entry.name.toLowerCase();
          
          // Check if it's an image file
          if (fileName.match(/\.(jpg|jpeg|png|webp|gif|bmp|tiff|heic|raf|cr2|nef|arw)$/)) {
            // Create a unique path for this file
            const filePath = path === '/' ? `/${entry.name}` : `${path}/${entry.name}`;
            
            try {
              const file = await fileHandle.getFile();
              
              // Store the file handle with its path
              fileParams.set(filePath, entry.name);
              
              // Create image object with expected format
              images.push({
                path: filePath,
                name: entry.name,
                is_edited: false,
                modified: file.lastModified,
                tags: [],
                exif: {},
                is_virtual_copy: false,
                width: 0,
                height: 0,
                size: file.size
              });
              
              console.log(`Found image: ${entry.name} at ${filePath}`);
            } catch (fileError) {
              console.error(`Error accessing file ${entry.name}:`, fileError);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error reading images from directory:', error);
    }
    
    console.log(`Total images found in ${path}: ${images.length}`);
    return images as any;
  }
  if (command === 'load_image') {
    const imagePath = args?.path;
    console.log(`Loading image from path: ${imagePath}`);
    
    if (!imagePath) {
      console.warn('No image path provided');
      return null as any;
    }
    
    // Update active path
    activeImagePath = imagePath;
    
    if (!rootDirectoryHandle) {
      console.warn('No root directory selected');
      return null as any;
    }
    
    try {
      // Extract filename from path
      const pathParts = imagePath.split('/').filter(p => p);
      const fileName = pathParts.pop();
      
      if (!fileName) {
        console.warn('Invalid image path');
        return null as any;
      }
      
      // Use helper to resolve path
      let fileHandle;
      try {
        fileHandle = await getHandleFromPath(imagePath);
      } catch (e) {
        console.warn('Could not resolve file handle for', imagePath, e);
        return null as any;
      }

      if (!fileHandle) {
        console.warn('File handle not found for', imagePath);
        return null as any;
      }
      const file = await fileHandle.getFile();
      const arrayBuffer = await file.arrayBuffer();
      
      console.log(`Successfully loaded image: ${fileName}, size: ${arrayBuffer.byteLength} bytes`);
      
      const blob = new Blob([arrayBuffer], { type: `image/${fileName.split('.').pop()?.toLowerCase() || 'jpeg'}` });
      
      return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
              const base64 = reader.result as string;
              
                  const img = new Image();
                  img.onload = () => {
                      resolve({
                          data: base64,
                          original_image_bytes: new Uint8Array(arrayBuffer),
                          width: img.width,
                          height: img.height,
                          is_raw: false, // Adding these to match App.tsx expectations
                          metadata: { adjustments: null },
                          exif: {}
                      } as any);
                  };
                  img.onerror = (e) => {
                      console.warn('Failed to load image for dimensions', e);
                      // Return 0 dimensions if failed, but still return data
                      resolve({
                          data: base64,
                          original_image_bytes: new Uint8Array(arrayBuffer),
                          width: 0,
                          height: 0,
                          is_raw: false,
                          metadata: { adjustments: null },
                          exif: {}
                      } as any);
                  };
              img.src = base64;
          };
          reader.onerror = (e) => {
              console.error('Error reading file as data URL', e);
              reject(e);
          };
          reader.readAsDataURL(blob);
      });
      
    } catch (error) {
      console.error(`Error loading image ${imagePath}:`, error);
      return null as any;
    }
  }
  // Mock returns for other commands
  if (command === 'get_app_settings') return {} as any;
  if (command === 'get_pinned_folder_trees') return [] as any;
  if (command === 'get_supported_file_types') return { 
    jpg: true, 
    jpeg: true, 
    png: true, 
    webp: true, 
    gif: true, 
    bmp: true,
    tiff: true,
    heic: true,
    raf: true,
    cr2: true,
    nef: true,
    arw: true
  } as any;
  if (command === 'check_update') return '1.0.0' as any;
  if (command === 'get_community_presets') return [] as any;
  if (command === 'get_image_ratings') return {} as any;
  if (command === 'get_image_dimensions') {
    // Try to get actual dimensions
    const imagePath = args?.path;
    if (imagePath) {
      return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
          resolve({ width: img.width, height: img.height } as any);
        };
        img.onerror = () => {
          resolve({ width: 0, height: 0 } as any);
        };
        // We need to load the image first
        invoke('load_image', { path: imagePath }).then((base64) => {
          if (base64) {
            img.src = base64 as string;
          } else {
            resolve({ width: 0, height: 0 } as any);
          }
        });
      });
    }
    return { width: 0, height: 0 } as any;
  }
  if (command === 'generate_preset_preview') return new Uint8Array() as any;
  if (command === 'check_comfyui_status') return { status: 'disconnected' } as any;
  if (command === 'cancel_thumbnail_generation') return null as any;
  if (command === 'start_background_indexing') return null as any;

  if (command === 'save_image') return '/mock/path.jpg' as any;
  if (command === 'export_library') return null as any;
  
  if (command === 'load_metadata') {
    // Return basic metadata to prevent UI issues
    return {
      adjustments: null,
      rating: 0,
      tags: [],
      version: 0,
      is_null: true
    } as any;
  }

  if (command === 'generate_thumbnails_progressive') {
    const paths = args?.paths || [];
    console.log(`Generating thumbnails for ${paths.length} images...`);
    
    // Process async to mimic behavior
    setTimeout(async () => {
      let completed = 0;
      const total = paths.length;

      for (const path of paths) {
        try {
          const handle = await getHandleFromPath(path);
          if (handle) {
            const file = await handle.getFile();
            // Just use the original image as "thumbnail" for now to save bandwidth/processing
            // In a real app we'd resize it.
            // Using object URL directly.
            const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'image/jpeg' });
            const url = URL.createObjectURL(blob);
            
            emit('thumbnail-generated', { path: path, thumbnail: url });
          }
        } catch (e) {
          console.error(`Failed to generate thumbnail for ${path}`, e);
        }
        completed++;
        // Emit progress
        emit('thumbnail-progress', { completed, total });
      }
      emit('thumbnail-generation-complete', {});
    }, 100);
    
    return null as any;
  }

  if (command === 'apply_adjustments') {
    console.log('[WebShim] apply_adjustments called', args);
    // For web version, we rely on CSS filters in ImageCanvas.tsx.
    // The backend would bake these in, but since we are mocking, we should NOT emit a "final" image
    // that is just the original raw bytes, because that might override the CSS preview.
    // By doing nothing (or just acknowledging), we let the live preview persist.
    console.log('[WebShim] apply_adjustments acknowledged (Client-side rendering active)');
    return null as any;
  }

  if (command === 'save_metadata_and_update_thumbnail') {
    console.log('[WebShim] save_metadata_and_update_thumbnail called', args);
    return null as any;
  }

  if (command === 'generate_uncropped_preview') {
      console.log('[WebShim] generate_uncropped_preview called', args);
      
      const imagePath = args?.path;
       setTimeout(async () => {
         try {
             if (imagePath) {
                 const result: any = await invoke('load_image', { path: imagePath });
                 if (result && result.data) {
                     const base64Data = result.data.split(',')[1];
                     const binaryString = window.atob(base64Data);
                     const bytes = new Uint8Array(binaryString.length);
                     for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                     }
                     emit('preview-update-uncropped', bytes);
                 }
             }
         } catch (e) {
             console.error('Error in generate_uncropped_preview', e);
         }
       }, 100);
      return null as any;
  }
  
  if (command === 'generate_original_transformed_preview') {
      console.log('[WebShim] generate_original_transformed_preview called');
      if (activeImagePath) {
         try {
             const result: any = await invoke('load_image', { path: activeImagePath });
             if (result && result.data) {
                 const base64Data = result.data.split(',')[1];
                 const binaryString = window.atob(base64Data);
                 const bytes = new Uint8Array(binaryString.length);
                 for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                 }
                 // Emit update for listeners
                 emit('preview-update-final', bytes);
                 return bytes as any;
             }
         } catch(e) {
             console.error('Error fetching active image for original preview', e);
         }
      }
      return new Uint8Array() as any;
  }

  if (command === 'generate_mask_overlay') {
       console.log('[WebShim] generate_mask_overlay called', args);
       // Return a transparent 1x1 pixel image to prevent errors
       // In a real implementation this would generate the red overlay
       return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKwkVQAAAABJRU5ErkJggg==' as any;
  }
  
  if (command === 'save_settings') {
      console.log('[WebShim] save_settings', args);
      return true as any;
  }

  if (command === 'check_comfyui_status') {
      // Simulate ComfyUI not running or not installed for web version
      // Or return false to indicate it's not active
      return false as any;
  }
  


  if (command === 'fetch_community_presets') {
      return [
        {
          name: 'Vibrant Sunset',
          creator: 'PhotoMaster',
          adjustments: { saturation: 1.2, contrast: 1.1, temperature: 10 }
        },
        {
          name: 'Moody BW',
          creator: 'ArtisticSoul',
          adjustments: { saturation: 0, contrast: 1.3, grainAmount: 20 }
        },
        {
          name: 'Cinematic Teal',
          creator: 'FilmLook',
          adjustments: { temperature: -10, tint: 10, contrast: 1.1 }
        }
      ] as any;
  }

  if (command === 'generate_all_community_previews') {
      // Return a map of presetName -> previewData (simulated as array of bytes)
      // We'll just mock this structure. CommunityPage expects Record<string, number[]>
      // But creating valid jpeg bytes manually is hard. 
      // Actually, CommunityPage uses `new Blob([new Uint8Array(imageData)], { type: 'image/jpeg' })`
      // So returning valid bytes is important for the Blob to be a valid image.
      // However, we can probably get away with returning an empty array if we handle the preview generation gracefully, 
      // OR we can try to return the same 1x1 pixel transparent gif bytes we used before, converted to number array.
      
      // 1x1 Transparent GIF bytes
      const transparentGif = [71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 0, 0, 0, 33, 249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0, 59];
      
      return {
          'Vibrant Sunset': transparentGif,
          'Moody BW': transparentGif,
          'Cinematic Teal': transparentGif
      } as any;
  }

  if (command === 'save_community_preset') {
      const { name, adjustments } = args;
      const newPreset = {
          preset: {
              id: crypto.randomUUID(),
              name: name,
              adjustments: adjustments
          }
      };
      mockPresets = [...mockPresets, newPreset];
      return true as any; 
  }

  console.warn(`Unhandled command: ${command}`);
  return null as any;
};

export const listen = async (event: string, handler: (payload: any) => void) => {
  console.log(`[WebShim] listen: ${event}`);
  
  if (!eventListeners.has(event)) {
    eventListeners.set(event, new Set());
  }
  eventListeners.get(event)!.add(handler);

  if (event === 'image-loaded') {
    setTimeout(() => {
      handler({ path: '/test.jpg', success: true });
    }, 100);
  }
  
  return () => {
    console.log(`[WebShim] unlisten: ${event}`);
    const handlers = eventListeners.get(event);
    if (handlers) {
      handlers.delete(handler);
    }
  };
};

const fileContentMap = new Map<string, string>();

export const open = async (options?: any) => {
  console.log(`[WebShim] open dialog`, options);
  
  // Check if we are selecting a directory or files
  if (options?.directory) {
      // Real File System Access API
      try {
        // @ts-ignore - showDirectoryPicker is experimental but supported in Chrome/Edge
        const dirHandle = await window.showDirectoryPicker({
          mode: 'read',
          id: 'rapidraw_working_dir',
        });

        rootDirectoryHandle = dirHandle;
        dirParams.clear();
        fileParams.clear();

        return '/' as any;
      } catch (e) {
        console.warn('Directory selection cancelled or failed:', e);
        return null;
      }

  } else {
      // File Picker (for presets, etc)
      if ('showOpenFilePicker' in window) {
          try {
              // @ts-ignore
              const [handle] = await window.showOpenFilePicker({
                  types: options?.filters ? options.filters.map((f: any) => ({
                      description: f.name,
                      accept: { 'application/json': f.extensions.map((e: string) => '.' + e) }
                  })) : [],
                  multiple: false
              });
              
              const file = await handle.getFile();
              const text = await file.text();
              const fakePath = `/imported/${file.name}`;
              fileContentMap.set(fakePath, text);
              console.log(`[WebShim] Cached content for ${fakePath}`);
              
              return fakePath as any;
          } catch (e) {
               console.warn('File selection cancelled:', e);
               return null;
          }
      }
      
      const fakePath = prompt("Enter a simulated file path for import (or cancel):", "/path/to/preset.rrpreset");
      if (!fakePath) return null;
      return fakePath as any;
  }
};
export const save = async (options?: any) => {
  console.log(`[WebShim] save dialog`, options);
  return null;
};
export const homeDir = async () => {
  return '/';
};
export const getCurrentWindow = () => ({
  isFullscreen: async () => false,
  setFullscreen: async (fullscreen: boolean) => {
    console.log(`Set fullscreen: ${fullscreen}`);
    return true;
  },
  onResized: (callback: () => void) => {
    window.addEventListener('resize', callback);
    return () => window.removeEventListener('resize', callback);
  },
});
export const relaunch = async () => {
  window.location.reload();
};
export const debug = {
  getRootHandle: () => rootDirectoryHandle,
  getDirParams: () => Array.from(dirParams.entries()),
  getFileParams: () => Array.from(fileParams.entries()),
  testLoadImage: async (path: string) => {
    return await invoke('load_image', { path });
  }
};
export const testFileSystem = async () => {
  if (!rootDirectoryHandle) {
    console.log('No directory selected. Please select a directory first.');
    return false;
  }
  
  try {
    console.log('Testing file system access...');
    
    // List first few files
    const fileList = [];
    for await (const entry of rootDirectoryHandle.values()) {
      fileList.push({ name: entry.name, kind: entry.kind });
      if (fileList.length >= 10) break;
    }
    
    console.log('First 10 entries:', fileList);
    
    // Count images
    let imageCount = 0;
    for await (const entry of rootDirectoryHandle.values()) {
      if (entry.kind === 'file' && entry.name.match(/\.(jpg|jpeg|png)$/i)) {
        imageCount++;
      }
    }
    
    console.log(`Found ${imageCount} image files`);
    return true;
    
  } catch (error) {
    console.error('File system test failed:', error);
    return false;
  }
};