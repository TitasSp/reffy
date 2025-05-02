const canvas = document.getElementById('canvas');
let canvasScale = 1;
const GRID_SIZE = 20; // Grid size constant
let zIndexCounter = 1;
const imageData = [];
const undoStack = [];
const redoStack = [];
let selectedWrappers = [];
let selectionBox = document.getElementById('selectionBox');
let isSelecting = false;
let isAlwaysOnTop = false;
let showUI = true;
let isModified = false;
let isScrolling = false; // Flag for canvas panning
let lastMouseX, lastMouseY; // Track last mouse position for panning
const placeholder = document.getElementById('placeholder');
const selectionCanvas = document.getElementById('selectionCanvas');
const selectionCtx = selectionCanvas.getContext('2d');
const scrollContainer = document.querySelector('.scroll-container');
let lastSavedState = null; // Track the last saved state to prevent duplication

// Keyboard shortcuts definition (unchanged)
const KEYBOARD_SHORTCUTS = {
  "Navigation": {
    "Ctrl + Mouse Wheel": "Fast zoom in/out",
    "Shift + Mouse Wheel": "Slow zoom in/out",
    "Middle Mouse Button / Spacebar + Drag": "Pan canvas", // Updated panning info
    "T": "Toggle UI visibility (Status Bar, Menu)", // Updated description
    "Spacebar": "Reset zoom to 100%",
    "Arrow Keys": "Pan canvas (small steps)"
  },
  "Image Manipulation": {
    "Drag": "Move selected images",
    "Alt + Drag": "Scale selected images",
    "Ctrl + Drag": "Move with grid snapping",
    "Click": "Select image",
    "Shift + Click": "Add/Remove from selection",
    "Shift + Drag on Canvas": "Draw selection box",
    "Ctrl + Click on Canvas": "Add to selection with box", // Clarified selection behavior
    "Delete / Backspace": "Remove selected images",
    "Right Click on Image": "Delete image", // Kept Right Click behavior
    "Ctrl + C": "Copy selected image (first one)",
    "Escape": "Deselect all images"
  },
  "File Operations": {
    "Ctrl + S": "Save scene",
    "Ctrl + O": "Open scene"
  },
  "Edit Operations": {
    "Ctrl + Z": "Undo",
    "Ctrl + Y": "Redo"
  },
  "Window": {
      "Tab": "Toggle Stay on Top" // Changed from Ctrl+T
  }
};


// DOMContentLoaded Listener
window.addEventListener('DOMContentLoaded', () => {
  // Resize selection canvas to match window size
  updateSelectionCanvasSize();

  // Load previous scene if exists
  const saved = localStorage.getItem('reffy-scene');
  if (saved) {
    try {
      const scene = JSON.parse(saved);
      // Add images without immediately focusing each time
      scene.forEach(img => addImageToCanvasInternal(img.src, img.left, img.top, img.width, img.height));
      updatePlaceholder(); // Update placeholder after adding all images
      updateStatusBar();   // Update status bar after adding all images
      focusViewOnImages(); // Center view on all images *after* loading
    } catch (e) {
      console.error('Error loading saved scene:', e);
      localStorage.removeItem('reffy-scene'); // Clear corrupted data
    }
  } else {
      // Ensure UI is updated even if no scene is loaded
      updatePlaceholder();
      updateStatusBar();
  }

  // No initial history save needed here, happens on first action
  // saveHistory(); // Remove initial saveHistory call

  setupEventListeners();

  // Initialize UI visibility state
  document.body.classList.toggle('ui-hidden', !showUI); // Consider if 'ui-hidden' class is used
});

function updateSelectionCanvasSize() {
  selectionCanvas.width = window.innerWidth;
  selectionCanvas.height = window.innerHeight;
}

window.addEventListener('resize', updateSelectionCanvasSize);

function setupEventListeners() {
  // Menu Buttons
  document.getElementById('menu-toggle').addEventListener('click', toggleSideMenu);
  document.getElementById('saveScene').addEventListener('click', saveSceneToFile);
  document.getElementById('loadTriggerBtn').addEventListener('click', () => document.getElementById('loadScene').click());
  document.getElementById('loadScene').addEventListener('change', e => loadSceneFromFile(e.target.files[0]));
  document.getElementById('clearBtn').addEventListener('click', clearCanvas);
  document.getElementById('stayOnTopBtn').addEventListener('click', toggleAlwaysOnTop);
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);
  document.getElementById('helpBtn').addEventListener('click', showKeyboardShortcuts); // Connect help button

  // Drag and Drop
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', handleDrop);

  // Canvas Interaction (Panning, Selection Box)
  scrollContainer.addEventListener('mousedown', handleCanvasMouseDown); // Listen on scrollContainer for panning start
  document.addEventListener('mousemove', handleCanvasMouseMove); // Global move listener
  document.addEventListener('mouseup', handleCanvasMouseUp);     // Global up listener

  // Zooming
  scrollContainer.addEventListener('wheel', handleZoom, { passive: false });

  // Keyboard and Clipboard
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('paste', handlePaste);

   // Deselect images if clicking directly on empty canvas area within scroll container
   scrollContainer.addEventListener('click', (e) => {
    // Deselect only if clicking directly on the scroll container or the canvas div itself,
    // and not starting a selection drag or clicking an image wrapper
    if ((e.target === scrollContainer || e.target === canvas) && !isSelecting && !e.shiftKey) {
      selectedWrappers = [];
      highlightSelected();
    }
  });
}

// --- Menu Toggle ---
function toggleSideMenu() {
    const menu = document.getElementById('side-menu');
    menu.classList.toggle('collapsed');
}

// --- Canvas Interaction Handlers ---
function handleCanvasMouseDown(e) {
    // Check if the click is directly on the scroll container or the canvas background
    // and not on an image wrapper or the side menu
    const clickedOnBackground = e.target === scrollContainer || e.target === canvas;
    const sideMenu = document.getElementById('side-menu');
    const isClickOnMenu = sideMenu && sideMenu.contains(e.target);

    if (isClickOnMenu) return; // Don't pan if clicking menu

    // Start selection box if Shift is pressed and clicked on background
    if (e.shiftKey && clickedOnBackground) {
        startSelection(e);
        e.preventDefault(); // Prevent default browser drag behavior if any
    }
    // Start panning if Middle Mouse Button is pressed OR (Spacebar is pressed AND Left Mouse Button is pressed)
    // and clicked on the background (or even over an image for panning)
    else if (e.button === 1 || (e.button === 0 && e.code === 'Space')) {
        isScrolling = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        scrollContainer.style.cursor = 'grabbing';
        e.preventDefault(); // Prevent text selection or other defaults
    }
    // If clicking on background without Shift or Middle Mouse/Space: Deselect (handled by 'click' listener)
}


function handleCanvasMouseMove(e) {
  // Handle selection box update
  if (isSelecting) {
    updateSelection(e);
    e.preventDefault(); // Prevent other actions while selecting
    return;
  }

  // Handle canvas panning (scrolling)
  if (isScrolling) {
    const dx = lastMouseX - e.clientX;
    const dy = lastMouseY - e.clientY;

    scrollContainer.scrollLeft += dx;
    scrollContainer.scrollTop += dy;

    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    e.preventDefault(); // Prevent text selection during pan
  }
}

function handleCanvasMouseUp(e) {
  // End selection box
  if (isSelecting) {
    endSelection(e);
    e.preventDefault();
  }

  // End panning
  if (isScrolling) {
    isScrolling = false;
    scrollContainer.style.cursor = 'default'; // Or 'grab' if you prefer
    e.preventDefault();
  }
}

// --- Image Handling ---

// Internal function to add image without saving history immediately (for batch loading)
function addImageToCanvasInternal(src, left, top, width = 200, height = 200, isNew = false) {
    const img = new Image();
    img.src = src;

    const wrapper = document.createElement('div');
    wrapper.className = 'image-wrapper';
    wrapper.style.left = `${left}px`;
    wrapper.style.top = `${top}px`;
    wrapper.style.width = `${width}px`;
    wrapper.style.height = `${height}px`;
    wrapper.style.zIndex = zIndexCounter++;

    wrapper.appendChild(img);
    canvas.appendChild(wrapper);

    // Find the index for the new data - important for linking wrapper and data
    const dataIndex = imageData.length;
    imageData.push({ wrapper, src }); // Add data first

    makeDraggableAndScalable(wrapper, dataIndex); // Pass index

    if (isNew) {
      updatePlaceholder();
      updateStatusBar();
      saveHistory('Add Image'); // Save history for this single new image
    }
}

// Public function for adding a single new image (e.g., from drop/paste)
function addImageToCanvas(src, left, top, width = 200, height = 200) {
    const img = new Image();
    img.onload = () => {
        // Use natural dimensions initially, but cap max size
        const maxDim = 400;
        const aspectRatio = img.naturalWidth / img.naturalHeight;
        let w = img.naturalWidth;
        let h = img.naturalHeight;

        if (w > maxDim || h > maxDim) {
            if (aspectRatio > 1) { // Wider than tall
                w = maxDim;
                h = maxDim / aspectRatio;
            } else { // Taller than wide or square
                h = maxDim;
                w = maxDim * aspectRatio;
            }
        }
        // Ensure minimum size
        w = Math.max(w, 50);
        h = Math.max(h, 50);

        // Adjust position to center the image based on its *actual* dimensions
        const finalLeft = left - w / 2;
        const finalTop = top - h / 2;

        addImageToCanvasInternal(src, finalLeft, finalTop, w, h, true); // Pass true for 'isNew'
    };
    img.onerror = () => {
        console.error("Failed to load image:", src);
        // Optionally add a placeholder or error message to the canvas
    };
    img.src = src;
}

// Modified makeDraggableAndScalable function
function makeDraggableAndScalable(wrapper, dataIndex) { // Accept dataIndex
  let isDragging = false;
  let isScaling = false;
  let startX, startY, startPositions = [], originalPositions = [];

  wrapper.addEventListener('mousedown', e => {
    // Prevent initiating pan/selection when clicking an image
    e.stopPropagation();

    // Don't drag if Alt or Middle mouse button is pressed (for scaling/panning)
    if (e.altKey || e.button === 1 || e.code === 'Space') {
        return;
    }

    wrapper.style.zIndex = zIndexCounter++;

    // Selection logic
    if (e.shiftKey) {
        // Toggle selection if shift is held
        const index = selectedWrappers.indexOf(wrapper);
        if (index > -1) {
            selectedWrappers.splice(index, 1); // Deselect
        } else {
            selectedWrappers.push(wrapper); // Select
        }
    } else if (!selectedWrappers.includes(wrapper)) {
        // If not shift-clicking and item isn't selected, select only this one
        selectedWrappers = [wrapper];
    }
    // If clicking an already selected item without shift, do nothing (keep selection)

    highlightSelected();

    // Determine action based on Alt key *at the start of the mousedown*
    isScaling = e.altKey;
    isDragging = !isScaling && e.button === 0; // Only drag with left button without Alt

    if (isDragging || isScaling) {
        startX = e.clientX;
        startY = e.clientY;
        scrollContainer.style.cursor = isScaling ? 'nwse-resize' : 'grabbing'; // Indicate scaling or grabbing

        // Store initial positions and dimensions for *all* selected items
        startPositions = selectedWrappers.map(w => {
            const style = w.style;
            return {
                wrapper: w,
                left: parseFloat(style.left) || 0,
                top: parseFloat(style.top) || 0,
                width: parseFloat(style.width) || 0,
                height: parseFloat(style.height) || 0
            };
        });
        // Store original positions separately for undo purposes
        originalPositions = startPositions.map(p => ({ ...p }));
    }
     e.preventDefault(); // Prevent browser image dragging
  });

  const handleMove = (e) => {
    if (!isDragging && !isScaling) return;
     e.preventDefault(); // Prevent text selection, etc.

    const dx = (e.clientX - startX) / canvasScale;
    const dy = (e.clientY - startY) / canvasScale;

    selectedWrappers.forEach((w, i) => {
      const start = startPositions[i];
      if (!start) return; // Safety check

      if (isDragging) {
        const newX = start.left + dx;
        const newY = start.top + dy;

        // Use Ctrl for grid snapping
        w.style.left = `${e.ctrlKey ? snapToGrid(newX) : newX}px`;
        w.style.top = `${e.ctrlKey ? snapToGrid(newY) : newY}px`;
      }
      if (isScaling) {
          // Calculate scale factor based on diagonal movement for more intuitive scaling
          const scaleFactor = 1 + (dx + dy) * 0.005; // Adjust multiplier sensitivity
          const newWidth = Math.max(20, start.width * scaleFactor); // Min width 20px
          const newHeight = Math.max(20, start.height * scaleFactor); // Min height 20px

          // Maintain aspect ratio (optional, but often desired)
          // For simplicity, this example scales width and height independently based on drag
          // To maintain aspect ratio, you'd calculate one dimension based on the other

          w.style.width = `${newWidth}px`;
          w.style.height = `${newHeight}px`;

          // Scaling typically doesn't involve grid snapping
      }
    });
    updateStatusBar(); // Update status bar during drag/scale
  };

  const handleMouseUp = (e) => {
    if (isDragging || isScaling) {
        // Only save history if positions actually changed significantly
        const moved = startPositions.some((start, i) => {
            const current = selectedWrappers[i];
            if (!current) return false;
            return Math.abs(start.left - (parseFloat(current.style.left) || 0)) > 0.1 ||
                   Math.abs(start.top - (parseFloat(current.style.top) || 0)) > 0.1 ||
                   Math.abs(start.width - (parseFloat(current.style.width) || 0)) > 0.1 ||
                   Math.abs(start.height - (parseFloat(current.style.height) || 0)) > 0.1;
        });

        if (moved) {
            saveHistory(isScaling ? 'Scale Images' : 'Move Images');
            isModified = true;
        }

        isDragging = false;
        isScaling = false;
        scrollContainer.style.cursor = 'default'; // Reset cursor
        // Don't prevent default on mouseup unless necessary
    }
  };

  // Use global listeners for move and up to catch mouse leaving the element
  document.addEventListener('mousemove', handleMove);
  document.addEventListener('mouseup', handleMouseUp);

  // Add context menu for deletion
  wrapper.addEventListener('contextmenu', e => {
    e.preventDefault();
    e.stopPropagation(); // Prevent canvas context menu if any
    // Select the right-clicked image if it wasn't already selected
    if (!selectedWrappers.includes(wrapper)) {
        selectedWrappers = [wrapper];
        highlightSelected();
    }
    // Optional: Show a confirmation or a custom context menu here
    // For now, directly delete selected images
    deleteSelectedImages();
  });
}


function snapToGrid(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function highlightSelected() {
  // Query all wrappers currently in the DOM under the canvas
  const currentWrappers = canvas.querySelectorAll('.image-wrapper');
  currentWrappers.forEach(w => w.classList.remove('selected'));
  // Add 'selected' class only to wrappers that are currently in the selectedWrappers array
  selectedWrappers.forEach(wrapper => {
      // Ensure the wrapper is still in the DOM before trying to add class
      if (wrapper && wrapper.isConnected) {
          wrapper.classList.add('selected');
      }
  });
  updateStatusBar();
}


// --- Selection Box ---
// Fixed startSelection function to account for canvas scale and scroll position
function startSelection(e) {
  // Should only start if shift is pressed and clicking on canvas/container background
  if (!e.shiftKey || !(e.target === canvas || e.target === scrollContainer)) return;

  isSelecting = true;

  // Use coordinates relative to the viewport initially
  selectionBox.startX = e.clientX;
  selectionBox.startY = e.clientY;

  // Store the starting position in canvas coordinates
  const rect = scrollContainer.getBoundingClientRect(); // Use scroll container rect
  const scrollX = scrollContainer.scrollLeft;
  const scrollY = scrollContainer.scrollTop;
  selectionBox.startCanvasX = (e.clientX - rect.left + scrollX) / canvasScale;
  selectionBox.startCanvasY = (e.clientY - rect.top + scrollY) / canvasScale;

  // Prepare the visual selection box element
  selectionBox.style.left = `${selectionBox.startX}px`;
  selectionBox.style.top = `${selectionBox.startY}px`;
  selectionBox.style.width = '0px';
  selectionBox.style.height = '0px';
  selectionBox.style.display = 'block'; // Make it visible

  // If not holding Ctrl, clear previous selection *at the start* of the drag
  if (!e.ctrlKey) {
    selectedWrappers = [];
    highlightSelected(); // Update visual highlight immediately
  }
   e.preventDefault(); // Prevent default drag behaviors
}

// Fixed updateSelection function
function updateSelection(e) {
  if (!isSelecting) return;

  // Calculate the visual box dimensions based on current and start viewport coordinates
  const currentX = e.clientX;
  const currentY = e.clientY;
  const left = Math.min(currentX, selectionBox.startX);
  const top = Math.min(currentY, selectionBox.startY);
  const width = Math.abs(currentX - selectionBox.startX);
  const height = Math.abs(currentY - selectionBox.startY);

  // Update the visual selection box style
  selectionBox.style.left = `${left}px`;
  selectionBox.style.top = `${top}px`;
  selectionBox.style.width = `${width}px`;
  selectionBox.style.height = `${height}px`;
   e.preventDefault();
}

// Fixed endSelection function
function endSelection(e) {
  if (!isSelecting) return;
  isSelecting = false;
  selectionBox.style.display = 'none'; // Hide visual box

  // Get canvas position and scroll
  const rect = scrollContainer.getBoundingClientRect(); // Use scroll container
  const scrollX = scrollContainer.scrollLeft;
  const scrollY = scrollContainer.scrollTop;

  // Calculate the current mouse position in canvas coordinates
  const currentCanvasX = (e.clientX - rect.left + scrollX) / canvasScale;
  const currentCanvasY = (e.clientY - rect.top + scrollY) / canvasScale;

  // Calculate the selection box's final rectangle in canvas coordinates
  const selectionRect = {
    x: Math.min(selectionBox.startCanvasX, currentCanvasX),
    y: Math.min(selectionBox.startCanvasY, currentCanvasY),
    width: Math.abs(selectionBox.startCanvasX - currentCanvasX),
    height: Math.abs(selectionBox.startCanvasY - currentCanvasY)
  };

  // Filter image data based on intersection with the canvas coordinate selection rectangle
  const newlySelectedData = imageData.filter(imgData => {
      if (!imgData || !imgData.wrapper || !imgData.wrapper.isConnected) return false; // Skip if data/wrapper invalid
      const wrapper = imgData.wrapper;
      const wrapperRect = {
          x: parseFloat(wrapper.style.left) || 0,
          y: parseFloat(wrapper.style.top) || 0,
          width: parseFloat(wrapper.style.width) || 0,
          height: parseFloat(wrapper.style.height) || 0
      };

      // Check for intersection (AABB collision detection)
      return (
          wrapperRect.x < selectionRect.x + selectionRect.width &&
          wrapperRect.x + wrapperRect.width > selectionRect.x &&
          wrapperRect.y < selectionRect.y + selectionRect.height &&
          wrapperRect.y + wrapperRect.height > selectionRect.y
      );
  });

  const newlySelectedWrappers = newlySelectedData.map(data => data.wrapper);

  // Update the main selectedWrappers array based on Ctrl key
  if (e.ctrlKey) {
      // Add newly selected items that aren't already in the list
      newlySelectedWrappers.forEach(wrapper => {
          if (!selectedWrappers.includes(wrapper)) {
              selectedWrappers.push(wrapper);
          }
      });
  } else {
      // If not Ctrl, the selection is exactly the items within the box
      selectedWrappers = newlySelectedWrappers;
  }

  highlightSelected(); // Update visuals
   e.preventDefault();
}

// --- Drag/Drop and Paste ---
function handleDrop(e) {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (!files.length) return;

  // Calculate drop position in canvas coordinates
  const rect = scrollContainer.getBoundingClientRect(); // Use scroll container
  const scrollX = scrollContainer.scrollLeft;
  const scrollY = scrollContainer.scrollTop;
  // This calculates the point on the canvas that was under the cursor
  const dropX = (e.clientX - rect.left + scrollX) / canvasScale;
  const dropY = (e.clientY - rect.top + scrollY) / canvasScale;

  files.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = (event) => {
          // Calculate slightly offset position for multiple drops
          const offsetX = (index % 5) * 20; // Stagger slightly
          const offsetY = Math.floor(index / 5) * 20;
          // addImageToCanvas will center the image on this point
          addImageToCanvas(event.target.result, dropX + offsetX, dropY + offsetY);
      };
      reader.readAsDataURL(file);
  });

  // Optional: Close side menu if open after dropping
  // document.getElementById('side-menu').classList.add('collapsed');
}


function handlePaste(e) {
  const items = Array.from(e.clipboardData.items).filter(item => item.type.startsWith('image/'));
  if (!items.length) return;

  // Calculate paste position: center of the current viewport
  const rect = scrollContainer.getBoundingClientRect();
  const scrollX = scrollContainer.scrollLeft;
  const scrollY = scrollContainer.scrollTop;
  const pasteX = (scrollX + rect.width / 2) / canvasScale;
  const pasteY = (scrollY + rect.height / 2) / canvasScale;

  items.forEach(item => {
      const blob = item.getAsFile();
      if (blob) {
          const reader = new FileReader();
          reader.onload = () => {
              addImageToCanvas(reader.result, pasteX, pasteY); // addImageToCanvas handles centering
          };
          reader.readAsDataURL(blob);
      }
  });
   e.preventDefault(); // Prevent pasting text into the window
}


// --- Keyboard Handler ---
function handleKeyDown(e) {
  // Allow typing in input fields if any exist in future
  // if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  // --- UI & Navigation ---
  if (e.key === 't' || e.key === 'T') {
    showUI = !showUI;
    // This assumes you have CSS rules for .ui-hidden to hide elements like status-bar, side-menu-toggle
    document.body.classList.toggle('ui-hidden', !showUI);
  } else if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey) { // Use Tab for Stay on Top
      e.preventDefault(); // Prevent focus change
      toggleAlwaysOnTop();
  } else if (e.code === 'Space' && !isScrolling && !isSelecting) { // Use Space for Reset Zoom (if not panning)
      e.preventDefault();
      resetZoom();
  }
  // Panning with Arrows
  else if (e.key === 'ArrowUp') { e.preventDefault(); scrollContainer.scrollTop -= 30; }
  else if (e.key === 'ArrowDown') { e.preventDefault(); scrollContainer.scrollTop += 30; }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); scrollContainer.scrollLeft -= 30; }
  else if (e.key === 'ArrowRight') { e.preventDefault(); scrollContainer.scrollLeft += 30; }

  // --- Image & Selection ---
  else if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelectedImages();
  } else if (e.key === 'Escape') {
    selectedWrappers = [];
    highlightSelected();
    // Also close shortcuts modal if open
    const modal = document.querySelector('#keyboard-shortcuts-modal');
     if (modal) modal.remove();
  } else if (e.ctrlKey && (e.key === 'a' || e.key === 'A')) { // Ctrl+A for Select All
      e.preventDefault();
      selectedWrappers = imageData.map(d => d.wrapper).filter(w => w && w.isConnected); // Select all valid wrappers
      highlightSelected();
  }

  // --- File & Edit ---
  else if (e.ctrlKey && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault();
    undo();
  } else if (e.ctrlKey && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault();
    redo();
  } else if (e.ctrlKey && (e.key === 's' || e.key === 'S')) {
    e.preventDefault();
    saveSceneToFile();
  } else if (e.ctrlKey && (e.key === 'o' || e.key === 'O')) {
    e.preventDefault();
    document.getElementById('loadScene').click(); // Trigger hidden input
  } else if (e.ctrlKey && (e.key === 'k' || e.key === 'K')) {
    e.preventDefault();
    toggleKeyboardShortcuts();
  } else if (e.ctrlKey && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    copySelectedToClipboard();
  }

  // Spacebar panning start (mousedown is in handleCanvasMouseDown)
   if (e.code === 'Space' && !isScrolling) {
       // Indicate panning is possible
       scrollContainer.style.cursor = 'grab';
   }
}

document.addEventListener('keyup', (e) => {
    // Reset cursor if spacebar panning was possible but not initiated
    if (e.code === 'Space' && !isScrolling) {
        scrollContainer.style.cursor = 'default';
    }
});


// --- Actions ---
function saveSceneToFile() {
  if (!imageData.length) {
      console.log("Canvas is empty, nothing to save.");
      // Optionally show a message to the user
      return;
  }
  const state = imageData.map(data => {
      if (!data || !data.wrapper || !data.wrapper.isConnected) return null; // Skip invalid data
      const style = data.wrapper.style;
      return {
          src: data.src, // Assuming src is always available and valid
          left: parseFloat(style.left) || 0,
          top: parseFloat(style.top) || 0,
          width: parseFloat(style.width) || 0,
          height: parseFloat(style.height) || 0
      };
  }).filter(item => item !== null); // Filter out any null entries

  if (!state.length) {
       console.log("No valid image data to save.");
       return;
  }

  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }); // Pretty print JSON
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // Suggest a filename
  const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
  a.download = `reffy-scene-${timestamp}.json`;
  document.body.appendChild(a); // Required for Firefox
  a.click();
  document.body.removeChild(a); // Clean up
  URL.revokeObjectURL(url);
  isModified = false; // Mark as saved
  console.log("Scene saved.");
}

function loadSceneFromFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data)) throw new Error("Invalid format: Data is not an array.");

      clearCanvas(false); // Clear without confirmation

      // Add images internally first
      data.forEach(img => {
          if (img && img.src && typeof img.left === 'number' && typeof img.top === 'number') {
             addImageToCanvasInternal(img.src, img.left, img.top, img.width, img.height);
          } else {
              console.warn("Skipping invalid image data during load:", img);
          }
      });

      // Update UI and focus *after* all images are processed
      updatePlaceholder();
      updateStatusBar();
      focusViewOnImages(); // Focus after loading all
      saveHistory('Load Scene'); // Save the loaded state as the initial history point

    } catch (error) {
      alert(`Error loading file: ${error.message}`);
      console.error('Error loading scene:', error);
    }
  };
  reader.onerror = () => alert('Error reading file');
  reader.readAsText(file);
  // Reset the file input value so the same file can be loaded again if needed
  document.getElementById('loadScene').value = null;
}

function deleteImage(wrapper) {
  // Find the corresponding data entry
  const index = imageData.findIndex(data => data && data.wrapper === wrapper);
  if (index !== -1) {
    // Remove wrapper from DOM
    if (wrapper && wrapper.parentNode) {
        wrapper.parentNode.removeChild(wrapper);
    }
    // Remove data from array
    imageData.splice(index, 1);

    // Remove from selection if present
    selectedWrappers = selectedWrappers.filter(w => w !== wrapper);

    // Note: History saving is handled by deleteSelectedImages or other callers
    // updatePlaceholder();
    // updateStatusBar();
    // isModified = true;
  } else {
      console.warn("Could not find data for wrapper to delete.");
  }
}

function deleteSelectedImages() {
    if (selectedWrappers.length === 0) return;
    const wrappersToDelete = [...selectedWrappers]; // Copy array as deleteImage modifies selection
    wrappersToDelete.forEach(deleteImage);
    selectedWrappers = []; // Clear selection
    highlightSelected();   // Update highlight (removes from deleted ones)
    updatePlaceholder();
    updateStatusBar();
    saveHistory('Delete Images'); // Save history after deletion
    isModified = true;
}


function clearCanvas(askConfirmation = true) {
  if (imageData.length === 0) return; // Nothing to clear
  if (askConfirmation && !confirm('Are you sure you want to clear all images? This cannot be undone directly by Ctrl+Z for the whole clear action.')) return;

  // Clear DOM
  canvas.innerHTML = '';
  // Clear Data
  imageData.length = 0;
  selectedWrappers = [];
  // Clear History (Clearing is a major action, often not desirable to undo in one step)
  // Consider if you want clear to be undoable. If so, save history *before* clearing.
  // For now, we assume clear resets history.
  undoStack.length = 0;
  redoStack.length = 0;
  // saveHistory('Clear Canvas'); // Save the empty state? Or just reset? Let's reset.

  updatePlaceholder();
  updateStatusBar();
  isModified = false; // Canvas is now saved in its empty state (or considered unmodified)
  localStorage.removeItem('reffy-scene'); // Also clear local storage
}


// --- History (Undo/Redo) ---
function saveHistory(actionName = 'Unknown Action') {
  // Create a deep copy of the current state
  const state = imageData.map(data => {
      if (!data || !data.wrapper || !data.wrapper.isConnected) return null;
      const style = data.wrapper.style;
      return {
          src: data.src,
          left: parseFloat(style.left) || 0,
          top: parseFloat(style.top) || 0,
          width: parseFloat(style.width) || 0,
          height: parseFloat(style.height) || 0
      };
  }).filter(item => item !== null); // Ensure only valid items are saved

  const currentState = JSON.stringify(state);

  // Prevent saving identical consecutive states
  if (undoStack.length > 0 && currentState === undoStack[undoStack.length - 1].state) {
    // console.log("Skipping save history - state identical.");
    return;
  }

  // Add to undo stack with action name
  undoStack.push({ state: currentState, action: actionName });

  // Limit undo stack size
  const maxHistory = 30;
  if (undoStack.length > maxHistory) {
    undoStack.shift(); // Remove the oldest entry
  }

  // Clear redo stack whenever a new action is performed
  if (redoStack.length > 0) {
      redoStack.length = 0;
  }

  // console.log(`History saved: ${actionName} (${undoStack.length} states)`);
  localStorage.setItem('reffy-scene', currentState); // Keep saving to localStorage as backup
}


function restoreScene(stateObject) {
  if (!stateObject || typeof stateObject.state !== 'string') {
      console.error("Invalid state object provided to restoreScene.");
      return;
  }

  const jsonState = stateObject.state;
  // isRestoring = true; // Flag not strictly necessary with current structure

  try {
    const data = JSON.parse(jsonState);
    if (!Array.isArray(data)) throw new Error("Invalid state format: Not an array.");

    // Clear existing DOM elements and data carefully
    canvas.innerHTML = '';
    imageData.length = 0;
    selectedWrappers = []; // Clear selection during restore

    // Re-add images based on the restored state
    data.forEach(img => {
        if (img && img.src && typeof img.left === 'number' && typeof img.top === 'number') {
            addImageToCanvasInternal(img.src, img.left, img.top, img.width, img.height); // Use internal add
        } else {
            console.warn("Skipping invalid image data during restore:", img);
        }
    });

    updatePlaceholder();
    updateStatusBar();
    highlightSelected(); // Ensure selection highlight is cleared
    // Do NOT focus view during undo/redo, it can be jarring.
    // focusViewOnImages();

  } catch (error) {
    console.error('Error restoring scene:', error);
    // Consider how to handle restoration errors - maybe revert to previous state?
  } finally {
      // isRestoring = false;
  }
}

function undo() {
  if (undoStack.length > 1) { // Need at least two states: current and previous
    const currentState = undoStack.pop(); // Remove current state
    redoStack.push(currentState);       // Add it to redo

    const previousState = undoStack[undoStack.length - 1]; // Peek at the new current state
    restoreScene(previousState);
    console.log(`Undo: ${currentState.action} -> Restored ${previousState.action || 'Previous State'}`);
    isModified = true; // Mark as modified after undo
    localStorage.setItem('reffy-scene', previousState.state); // Update backup storage
  } else {
    console.log("Nothing to undo.");
  }
}

function redo() {
  if (redoStack.length > 0) {
    const nextState = redoStack.pop(); // Get state to restore
    undoStack.push(nextState);       // Add it back to undo stack

    restoreScene(nextState);
    console.log(`Redo: Restored ${nextState.action || 'Next State'}`);
    isModified = true; // Mark as modified after redo
    localStorage.setItem('reffy-scene', nextState.state); // Update backup storage
  } else {
      console.log("Nothing to redo.");
  }
}

// --- UI Updates ---
function updatePlaceholder() {
  placeholder.style.display = imageData.length === 0 ? 'flex' : 'none'; // Use flex for centering if needed
}

// Enhanced zoom handler (logic seems correct for cursor following)
function handleZoom(e) {
  e.preventDefault();

  // Get mouse position relative to scroll container's viewport
  const rect = scrollContainer.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  // Current scroll position
  const scrollX = scrollContainer.scrollLeft;
  const scrollY = scrollContainer.scrollTop;

  // Calculate cursor position in the canvas coordinate system *before* zoom
  const cursorXBeforeZoom = (scrollX + mouseX) / canvasScale;
  const cursorYBeforeZoom = (scrollY + mouseY) / canvasScale;

  // Determine zoom speed
  let scaleAmount;
  const baseSpeed = 0.001; // Base sensitivity
  if (e.ctrlKey) {
    scaleAmount = e.deltaY * -baseSpeed * 2; // Faster zoom with Ctrl
  } else if (e.shiftKey) {
    scaleAmount = e.deltaY * -baseSpeed * 0.5; // Slower zoom with Shift
  } else {
    scaleAmount = e.deltaY * -baseSpeed; // Normal zoom
  }

  // Calculate new scale, clamping between min and max values
  const minScale = 0.02;
  const maxScale = 20.0;
  let newScale = canvasScale * (1 + scaleAmount); // Multiplicative zoom feels more natural
  newScale = Math.min(maxScale, Math.max(minScale, newScale));

  // Apply zoom only if scale actually changed
  if (newScale !== canvasScale) {
    // Apply scale transform
    canvas.style.transform = `scale(${newScale})`;
    // Keep transform origin at top-left
    canvas.style.transformOrigin = '0 0';

    // Calculate where the cursor position (in canvas coordinates) is now located in the viewport *after* zoom
    const cursorXAfterZoom = cursorXBeforeZoom * newScale;
    const cursorYAfterZoom = cursorYBeforeZoom * newScale;

    // Calculate the new scroll position needed to keep the point under the cursor stationary
    const newScrollX = cursorXAfterZoom - mouseX;
    const newScrollY = cursorYAfterZoom - mouseY;

    // Apply the new scroll position
    scrollContainer.scrollLeft = newScrollX;
    scrollContainer.scrollTop = newScrollY;

    // Update the global scale variable
    canvasScale = newScale;

    // Update the status bar display
    updateStatusBar();
  }
}


// Improved reset zoom function with animation
function resetZoom() {
  // Get current center of viewport in canvas coordinates
  const viewportWidth = scrollContainer.clientWidth;
  const viewportHeight = scrollContainer.clientHeight;
  const currentCenterX = (scrollContainer.scrollLeft + viewportWidth / 2) / canvasScale;
  const currentCenterY = (scrollContainer.scrollTop + viewportHeight / 2) / canvasScale;

  // Target scale is 1
  const targetScale = 1;

  // Apply smooth transition
  canvas.style.transition = 'transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)'; // Smoother ease-out
  canvasScale = targetScale;
  canvas.style.transform = `scale(${canvasScale})`;

  // Calculate new scroll position to keep the *center* of the view constant
  const newScrollX = currentCenterX * targetScale - viewportWidth / 2;
  const newScrollY = currentCenterY * targetScale - viewportHeight / 2;
  scrollContainer.scrollLeft = newScrollX;
  scrollContainer.scrollTop = newScrollY;

  // Remove transition after animation completes to prevent affecting subsequent transforms
  setTimeout(() => {
    canvas.style.transition = '';
  }, 300); // Match transition duration

  updateStatusBar();
}

async function copySelectedToClipboard() {
    if (selectedWrappers.length === 0 || !navigator.clipboard || !window.ClipboardItem) {
        console.log("Nothing selected or Clipboard API not supported.");
        return;
    }

    // Use the first selected image's source
    const wrapper = selectedWrappers[0];
    const imgElement = wrapper.querySelector('img');
    if (!imgElement || !imgElement.src) {
        console.error("Could not find image source for selected item.");
        return;
    }

    try {
        // Fetch the image data (handles data URLs and potentially external URLs if CORS allows)
        const response = await fetch(imgElement.src);
        if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.statusText}`);
        }
        const blob = await response.blob();

        // Create a ClipboardItem with the blob
        const item = new ClipboardItem({ [blob.type]: blob });

        // Write to clipboard
        await navigator.clipboard.write([item]);
        console.log("Image copied to clipboard.");
        // Optionally provide user feedback (e.g., flash a message)

    } catch (err) {
        console.error('Failed to copy image to clipboard:', err);
        // Provide error feedback to user if needed
    }
}


// Toggle keyboard shortcuts modal
function toggleKeyboardShortcuts() {
    const modal = document.querySelector('#keyboard-shortcuts-modal');
    if (modal) {
        modal.remove();
    } else {
        showKeyboardShortcuts();
    }
}

// Show helpful keyboard shortcuts
function showKeyboardShortcuts() {
    // Check if modal already exists
    if (document.querySelector('#keyboard-shortcuts-modal')) return;

    const modal = document.createElement('div');
    modal.id = 'keyboard-shortcuts-modal';
    // Basic styles - can be enhanced in CSS
    modal.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background-color: var(--bg-darker);
        color: var(--text);
        border: 1px solid var(--accent);
        border-radius: 8px;
        padding: 25px;
        width: 90%;
        max-width: 600px;
        max-height: 80vh;
        overflow-y: auto;
        z-index: 1002; /* Above side menu */
        box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        font-size: 14px;
    `;

    const header = document.createElement('h2');
    header.textContent = 'Keyboard Shortcuts';
    header.style.color = 'var(--accent)';
    header.style.marginBottom = '20px';
    header.style.marginTop = '0';
    modal.appendChild(header);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = `
        position: absolute;
        top: 10px;
        right: 15px;
        background: none;
        border: none;
        color: var(--text-dim);
        font-size: 24px;
        cursor: pointer;
        padding: 5px;
        line-height: 1;
    `;
    closeBtn.onmouseover = () => closeBtn.style.color = 'var(--text)';
    closeBtn.onmouseout = () => closeBtn.style.color = 'var(--text-dim)';
    closeBtn.onclick = () => modal.remove();
    modal.appendChild(closeBtn);

    // Create content container for scrolling
    const content = document.createElement('div');

    for (const [category, shortcuts] of Object.entries(KEYBOARD_SHORTCUTS)) {
        const section = document.createElement('div');
        section.style.marginBottom = '20px';

        const categoryHeader = document.createElement('h3');
        categoryHeader.textContent = category;
        categoryHeader.style.color = 'var(--accent-hover)';
        categoryHeader.style.marginBottom = '12px';
        categoryHeader.style.paddingBottom = '5px';
        categoryHeader.style.borderBottom = '1px solid var(--accent-hover)';
        section.appendChild(categoryHeader);

        for (const [key, description] of Object.entries(shortcuts)) {
            const shortcut = document.createElement('div');
            shortcut.style.display = 'flex';
            shortcut.style.justifyContent = 'space-between';
            shortcut.style.marginBottom = '8px';
            shortcut.style.lineHeight = '1.6';

            const keySpan = document.createElement('span');
            keySpan.textContent = key;
            keySpan.style.fontWeight = '600'; // Bolder keys
            keySpan.style.fontFamily = "'Consolas', 'Menlo', monospace"; // Monospace font
            keySpan.style.backgroundColor = 'rgba(255, 255, 255, 0.05)'; // Subtle background
            keySpan.style.padding = '3px 6px';
            keySpan.style.borderRadius = '3px';
            keySpan.style.marginRight = '15px';
            keySpan.style.whiteSpace = 'nowrap'; // Prevent keys wrapping

            const descSpan = document.createElement('span');
            descSpan.textContent = description;
            descSpan.style.textAlign = 'right';

            shortcut.appendChild(keySpan);
            shortcut.appendChild(descSpan);
            section.appendChild(shortcut);
        }
        content.appendChild(section);
    }

    modal.appendChild(content);
    document.body.appendChild(modal);

    // Close modal if clicking outside of it
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.remove();
        }
    });
}


function updateStatusBar() {
  const zoomPercent = Math.round(canvasScale * 100);
  document.getElementById('zoom-level').textContent = `${zoomPercent}%`;
  document.getElementById('image-count').textContent = `${imageData.length} item${imageData.length !== 1 ? 's' : ''}`;

  if (selectedWrappers.length === 0) {
    document.getElementById('selection-info').textContent = 'No selection';
  } else if (selectedWrappers.length === 1) {
    const w = selectedWrappers[0];
    // Ensure styles are computed if needed, but direct style access is faster if set inline
    const width = parseFloat(w.style.width) || 0;
    const height = parseFloat(w.style.height) || 0;
    const left = parseFloat(w.style.left) || 0;
    const top = parseFloat(w.style.top) || 0;
    document.getElementById('selection-info').textContent =
      `${Math.round(width)}×${Math.round(height)} @ ${Math.round(left)},${Math.round(top)}`;
  } else {
    document.getElementById('selection-info').textContent = `${selectedWrappers.length} items selected`;
  }
}

// Toggle Always On Top (Requires Electron main process setup)
function toggleAlwaysOnTop() {
    isAlwaysOnTop = !isAlwaysOnTop;
    const btn = document.getElementById('stayOnTopBtn');
    btn.style.backgroundColor = isAlwaysOnTop ? 'var(--accent)' : ''; // Visual feedback
    btn.style.color = isAlwaysOnTop ? 'var(--bg-darker)' : 'var(--text)';
    // Check if the Electron API is available before calling
    if (window.electronAPI && typeof window.electronAPI.setAlwaysOnTop === 'function') {
        window.electronAPI.setAlwaysOnTop(isAlwaysOnTop);
    } else {
        console.warn('Electron API for setAlwaysOnTop not available.');
        // Optionally disable the button if API is missing
    }
}

function focusViewOnImages() {
  if (!imageData.length) return; // No images, nothing to focus on

  // Calculate bounding box of all valid images
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let validImageFound = false;

  imageData.forEach(({ wrapper }) => {
      if (!wrapper || !wrapper.isConnected) return; // Skip invalid items
      const x = parseFloat(wrapper.style.left) || 0;
      const y = parseFloat(wrapper.style.top) || 0;
      const w = parseFloat(wrapper.style.width) || 50; // Use min width if parse fails
      const h = parseFloat(wrapper.style.height) || 50;// Use min height if parse fails
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + w);
      maxY = Math.max(maxY, y + h);
      validImageFound = true;
  });

  if (!validImageFound) return; // No valid images found

  const boundsWidth = maxX - minX;
  const boundsHeight = maxY - minY;
  const boundsCenterX = minX + boundsWidth / 2;
  const boundsCenterY = minY + boundsHeight / 2;

  // Calculate required scale to fit bounds within viewport (with padding)
  const padding = 50; // Pixels padding around the content
  const viewportWidth = scrollContainer.clientWidth - 2 * padding;
  const viewportHeight = scrollContainer.clientHeight - 2 * padding;

  // Check for zero dimensions to avoid division by zero
  if (boundsWidth <= 0 || boundsHeight <= 0 || viewportWidth <= 0 || viewportHeight <= 0) {
      // Fallback: just center the view at the calculated center point with current scale
      scrollContainer.scrollLeft = boundsCenterX * canvasScale - scrollContainer.clientWidth / 2;
      scrollContainer.scrollTop = boundsCenterY * canvasScale - scrollContainer.clientHeight / 2;
      return;
  }

  const scaleX = viewportWidth / boundsWidth;
  const scaleY = viewportHeight / boundsHeight;
  const targetScale = Math.min(scaleX, scaleY, 2.0); // Fit within view, but don't zoom out too much (max scale = 2.0 for focus)

  // Clamp scale to min/max limits
  const minScale = 0.02;
  const maxScale = 20.0;
  canvasScale = Math.min(maxScale, Math.max(minScale, targetScale));

  // Apply the new scale (no transition needed for initial focus)
  canvas.style.transform = `scale(${canvasScale})`;
  canvas.style.transformOrigin = '0 0';

  // Calculate new scroll position to center the bounds
  const newScrollX = boundsCenterX * canvasScale - scrollContainer.clientWidth / 2;
  const newScrollY = boundsCenterY * canvasScale - scrollContainer.clientHeight / 2;
  scrollContainer.scrollLeft = newScrollX;
  scrollContainer.scrollTop = newScrollY;

  updateStatusBar(); // Update zoom display
}


// Autosave periodically (optional)
// setInterval(() => {
//   if (isModified) {
//     saveHistory('Autosave');
//     isModified = false;
//     console.log("Autosaved state.");
//   }
// }, 60000); // Autosave every 60 seconds