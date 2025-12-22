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

export const invoke = async <T = any>(command: string, args?: any): Promise<T> => {
  console.log(`[WebShim] invoke: ${command}`, args);
  
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
      
      // Navigate to directory containing the image
      let currentHandle = rootDirectoryHandle;
      for (const part of pathParts) {
        currentHandle = await currentHandle.getDirectoryHandle(part);
      }
      
      // Get the file handle
      const fileHandle = await currentHandle.getFileHandle(fileName);
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
    const imagePath = args?.path;
    
    // Simulate processing delay
    setTimeout(async () => {
         // Emit the original image so the user sees something valid instead of a white placeholder
         try {
             if (imagePath) {
                 const result: any = await invoke('load_image', { path: imagePath });
                 if (result && result.data) {
                     // Convert base64 data back to Uint8Array for the preview-update-final event
                     // The event expects raw bytes, not base64 string
                     const base64Data = result.data.split(',')[1];
                     const binaryString = window.atob(base64Data);
                     const bytes = new Uint8Array(binaryString.length);
                     for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                     }
                     emit('preview-update-final', bytes);
                     return;
                 }
             }
         } catch (e) {
             console.error('Error loading original image for preview simulation', e);
         }
    }, 100);
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
export const open = async (options?: any) => {
  console.log(`[WebShim] open dialog`, options);
  
  if (options?.directory) {
    if ('showDirectoryPicker' in window) {
      try {
        // @ts-ignore
        const handle = await window.showDirectoryPicker({
          id: 'image-browser',
          startIn: 'pictures',
          mode: 'read'
        });
        
        rootDirectoryHandle = handle;
        dirParams.clear();
        fileParams.clear();
        
        console.log(`Opened directory: ${handle.name}`);
        
        return '/' as any;
        
      } catch (e) {
        if (e.name === 'AbortError') {
          console.log('User cancelled directory picker');
        } else {
          console.error('Error opening directory:', e);
        }
        return null;
      }
    } else {
      console.error('File System Access API not supported');
      alert('Please use Chrome/Edge 86+ or Opera 72+ for file system access');
      return '/test-directory' as any;
    }
  }
  
  return null;
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