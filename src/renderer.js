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
let isScrolling = false; // New flag for canvas scrolling
let lastMouseX, lastMouseY; // Track last mouse position for scrolling
const placeholder = document.getElementById('placeholder');
const selectionCanvas = document.getElementById('selectionCanvas');
const selectionCtx = selectionCanvas.getContext('2d');
const scrollContainer = document.querySelector('.scroll-container');
let lastSavedState = null; // Track the last saved state to prevent duplication

const KEYBOARD_SHORTCUTS = {
  "Navigation": {
    "Ctrl + Mouse Wheel": "Fast zoom in/out",
    "Shift + Mouse Wheel": "Slow zoom in/out",
    "Middle Mouse Button": "Pan canvas",
    "T": "Toggle UI visibility"
  },
  "Image Manipulation": {
    "Alt + Drag": "Scale selected images",
    "Ctrl + Drag": "Move with grid snapping",
    "Shift + Click": "Multiple selection",
    "Delete": "Remove selected images",
    "Right Click": "Delete image"
  },
  "File Operations": {
    "Ctrl + S": "Save scene",
    "Ctrl + O": "Open scene"
  },
  "Edit Operations": {
    "Ctrl + Z": "Undo",
    "Ctrl + Y": "Redo"
  }
};


// Fixed event listener for Tab/T key UI toggle
window.addEventListener('DOMContentLoaded', () => {
  // Resize selection canvas to match window size
  updateSelectionCanvasSize();
  
  const saved = localStorage.getItem('reffy-scene');
  if (saved) {
    try {
      const scene = JSON.parse(saved);
      scene.forEach(img => addImageToCanvas(img.src, img.left, img.top, img.width, img.height));
    } catch (e) {
      console.error('Error loading saved scene:', e);
    }
  }

  const helpBtn = document.createElement('button');
  helpBtn.textContent = '❔';
  helpBtn.title = 'Keyboard Shortcuts (Ctrl+K)';
  helpBtn.style.cursor = 'pointer';
  helpBtn.addEventListener('click', () => {
    const modal = document.querySelector('#keyboard-shortcuts-modal');
    if (modal) {
      document.body.removeChild(modal);
    } else {
      showKeyboardShortcuts();
    }
  });
  document.getElementById('toolbar').appendChild(helpBtn);


  saveHistory();
  setupEventListeners();
  updatePlaceholder();
  updateStatusBar();
  
  // Initialize UI visibility state
  document.body.classList.toggle('ui-hidden', !showUI);
});

function updateSelectionCanvasSize() {
  selectionCanvas.width = window.innerWidth;
  selectionCanvas.height = window.innerHeight;
}

window.addEventListener('resize', updateSelectionCanvasSize);

function setupEventListeners() {
  document.getElementById('saveScene').addEventListener('click', saveSceneToFile);
  document.getElementById('loadScene').addEventListener('change', e => loadSceneFromFile(e.target.files[0]));
  document.getElementById('clearBtn').addEventListener('click', clearCanvas);
  document.getElementById('stayOnTopBtn').addEventListener('click', toggleAlwaysOnTop);
  document.getElementById('undoBtn').addEventListener('click', undo);
  document.getElementById('redoBtn').addEventListener('click', redo);

  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', handleDrop);
  
  // Canvas scrolling with mousedown
  canvas.addEventListener('mousedown', handleCanvasMouseDown);
  document.addEventListener('mousemove', handleCanvasMouseMove);
  document.addEventListener('mouseup', handleCanvasMouseUp);
  
  // Fix for zoom handling
  scrollContainer.addEventListener('wheel', handleZoom, { passive: false });
  
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('paste', handlePaste);

   // Deselect images if clicking directly on canvas
   canvas.addEventListener('click', (e) => {
    if (e.target === canvas && !isSelecting) {
      selectedWrappers = [];
      highlightSelected();
    }
  });
}

function handleCanvasMouseDown(e) {
  if (e.target !== canvas) return;
  
  if (e.shiftKey) {
    // Start selection box when shift is pressed
    startSelection(e);
  } else if (!e.altKey && !e.ctrlKey) {
    // Start scrolling when mouse is pressed on canvas (no modifier keys)
    isScrolling = true;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    canvas.style.cursor = 'grabbing';
    e.preventDefault();
  }
}

function handleCanvasMouseMove(e) {
  // Handle selection box update
  if (isSelecting) {
    updateSelection(e);
    return;
  }
  
  // Handle canvas scrolling
  if (isScrolling) {
    const dx = lastMouseX - e.clientX;
    const dy = lastMouseY - e.clientY;
    
    scrollContainer.scrollLeft += dx;
    scrollContainer.scrollTop += dy;
    
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    e.preventDefault();
  }
}

function handleCanvasMouseUp(e) {
  if (isSelecting) {
    endSelection(e);
  }
  
  if (isScrolling) {
    isScrolling = false;
    canvas.style.cursor = 'default';
  }
}

async function addImageToCanvas(src, left = 100, top = 100, width = null, height = null) {
  const img = new Image();
  img.src = src;
  await img.decode();

  if (!width) width = img.naturalWidth;
  if (!height) height = img.naturalHeight;

  const wrapper = document.createElement('div');
  wrapper.className = 'image-wrapper';
  wrapper.style.left = `${left}px`;
  wrapper.style.top = `${top}px`;
  wrapper.style.width = `${width}px`;
  wrapper.style.height = `${height}px`;
  wrapper.style.zIndex = zIndexCounter++;

  img.style.width = '100%';
  img.style.height = '100%';
  wrapper.appendChild(img);
  canvas.appendChild(wrapper);

  const imageObj = { wrapper, src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight };
  imageData.push(imageObj);

  makeDraggableAndScalable(wrapper);
  if (!isRestoring) saveHistory();

  updatePlaceholder();
  updateStatusBar();
  isModified = true;

  return wrapper;
}

// Modified makeDraggableAndScalable function to use Ctrl for grid snapping
function makeDraggableAndScalable(wrapper) {
  let isDragging = false;
  let isScaling = false;
  let startX, startY, startPositions = [];

  wrapper.addEventListener('mousedown', e => {
    e.preventDefault();
    e.stopPropagation();
    wrapper.style.zIndex = zIndexCounter++;

    if (!selectedWrappers.includes(wrapper)) {
      selectedWrappers = e.shiftKey ? [...selectedWrappers, wrapper] : [wrapper];
    }
    highlightSelected();

    isScaling = e.altKey;
    isDragging = !isScaling;
    startX = e.clientX;
    startY = e.clientY;

    // Store initial positions
    startPositions = selectedWrappers.map(w => ({
      wrapper: w,
      left: parseFloat(w.style.left),
      top: parseFloat(w.style.top),
      width: parseFloat(w.style.width),
      height: parseFloat(w.style.height)
    }));
  });

  document.addEventListener('mousemove', e => {
    if (!isDragging && !isScaling) return;
    const dx = (e.clientX - startX) / canvasScale;
    const dy = (e.clientY - startY) / canvasScale;

    selectedWrappers.forEach((w, i) => {
      const start = startPositions[i];
      if (isDragging) {
        const newX = start.left + dx;
        const newY = start.top + dy;
        
        // Changed to use Ctrl for grid snapping
        w.style.left = `${e.ctrlKey ? snapToGrid(newX) : newX}px`;
        w.style.top = `${e.ctrlKey ? snapToGrid(newY) : newY}px`;
      }
      if (isScaling) {
        const scale = 1 + (dx + dy) / 500;
        w.style.width = `${Math.max(50, start.width * scale)}px`;
        w.style.height = `${Math.max(50, start.height * scale)}px`;
      }
    });

    // Edge scrolling when dragging objects
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    const scrollSpeed = 20;

    if (mouseX < rect.left + 50) {
      scrollContainer.scrollLeft -= scrollSpeed;
    } else if (mouseX > rect.right - 50) {
      scrollContainer.scrollLeft += scrollSpeed;
    }

    if (mouseY < rect.top + 50) {
      scrollContainer.scrollTop -= scrollSpeed;
    } else if (mouseY > rect.bottom - 50) {
      scrollContainer.scrollTop += scrollSpeed;
    }
  });

  document.addEventListener('mouseup', () => {
    if (isDragging || isScaling) {
      saveHistory();
      isModified = true;
    }
    isDragging = false;
    isScaling = false;
  });

  wrapper.addEventListener('contextmenu', e => {
    e.preventDefault();
    deleteImage(wrapper);
  });
}

function snapToGrid(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

function highlightSelected() {
  imageData.forEach(item => item.wrapper.classList.remove('selected'));
  selectedWrappers.forEach(wrapper => wrapper.classList.add('selected'));
  updateStatusBar();
}

// Fixed startSelection function to account for canvas scale and scroll position
function startSelection(e) {
  if (e.target !== canvas && !e.shiftKey) return;
  isSelecting = true;

  // Convert mouse coordinates to account for scroll position and scale
  const rect = canvas.getBoundingClientRect();
  const scrollX = scrollContainer.scrollLeft;
  const scrollY = scrollContainer.scrollTop;
  
  // Clear previous selectedWrappers if not holding Ctrl key
  if (!e.ctrlKey) {
    selectedWrappers = [];
    highlightSelected();
  }

  // Store the starting position in screen coordinates
  selectionBox.startX = e.clientX;
  selectionBox.startY = e.clientY;
  
  // Also store canvas coordinates for actual selection calculations
  selectionBox.startCanvasX = (e.clientX - rect.left + scrollX) / canvasScale;
  selectionBox.startCanvasY = (e.clientY - rect.top + scrollY) / canvasScale;
  
  // Clear the selection canvas
  selectionCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);
}

// Fixed updateSelection function
function updateSelection(e) {
  if (!isSelecting) return;

  // Calculate the selection box dimensions in screen coordinates
  const left = Math.min(e.clientX, selectionBox.startX);
  const top = Math.min(e.clientY, selectionBox.startY);
  const width = Math.abs(e.clientX - selectionBox.startX);
  const height = Math.abs(e.clientY - selectionBox.startY);

  // Clear the selection canvas
  selectionCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);

  // Draw the selection box
  selectionCtx.strokeStyle = 'rgba(76, 175, 80, 1)';
  selectionCtx.lineWidth = 2;
  selectionCtx.setLineDash([5, 5]);
  selectionCtx.strokeRect(left, top, width, height);
  selectionCtx.fillStyle = 'rgba(76, 175, 80, 0.2)';
  selectionCtx.fillRect(left, top, width, height);
}

// Fixed endSelection function
function endSelection(e) {
  if (!isSelecting) return;
  isSelecting = false;

  // Clear the selection canvas
  selectionCtx.clearRect(0, 0, selectionCanvas.width, selectionCanvas.height);

  // Get current canvas position and scroll
  const rect = canvas.getBoundingClientRect();
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

  // Filter selected wrappers based on the selection box
  const newSelections = imageData.filter(img => {
    const wrapper = img.wrapper;
    const wrapperRect = {
      x: parseFloat(wrapper.style.left),
      y: parseFloat(wrapper.style.top),
      width: parseFloat(wrapper.style.width),
      height: parseFloat(wrapper.style.height)
    };

    // Check if the wrapper intersects with the selection box
    return (
      wrapperRect.x < selectionRect.x + selectionRect.width &&
      wrapperRect.x + wrapperRect.width > selectionRect.x &&
      wrapperRect.y < selectionRect.y + selectionRect.height &&
      wrapperRect.y + wrapperRect.height > selectionRect.y
    );
  }).map(img => img.wrapper);
  
  // Add new selections to existing selections if Ctrl key is pressed
  if (e.ctrlKey) {
    // Add only items that aren't already selected
    newSelections.forEach(wrapper => {
      if (!selectedWrappers.includes(wrapper)) {
        selectedWrappers.push(wrapper);
      }
    });
  } else {
    selectedWrappers = newSelections;
  }

  highlightSelected();
}

async function handleDrop(e) {
  e.preventDefault();
  const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
  if (!files.length) return;

  const rect = canvas.getBoundingClientRect();
  const scrollX = scrollContainer.scrollLeft;
  const scrollY = scrollContainer.scrollTop;
  
  let x = (e.clientX - rect.left + scrollX) / canvasScale;
  const y = (e.clientY - rect.top + scrollY) / canvasScale;

  for (const file of files) {
    const reader = new FileReader();
    reader.onload = () => addImageToCanvas(reader.result, x, y);
    reader.readAsDataURL(file);
    x += 20; // Offset for multiple drops
  }
  reader.onload = () => {
    const dropX = x - img.naturalWidth / 2;
    const dropY = y - img.naturalHeight / 2;
    addImageToCanvas(reader.result, dropX, dropY);
  };
  

}

function handlePaste(e) {
  const items = Array.from(e.clipboardData.items).filter(item => item.type.startsWith('image/'));
  if (!items.length) return;

  const item = items[0];
  const blob = item.getAsFile();
  const reader = new FileReader();
  reader.onload = () => addImageToCanvas(reader.result, 100, 100);
  reader.readAsDataURL(blob);
}

function handleKeyDown(e) {
  if (e.key === 't') {
    showUI = !showUI;
    document.body.classList.toggle('ui-hidden', !showUI);
  }
  if (e.key === 'Delete') {
    selectedWrappers.forEach(deleteImage);
    selectedWrappers = [];
    highlightSelected();
  }
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    undo();
  }
  if (e.ctrlKey && e.key === 'y') {
    e.preventDefault();
    redo();
  }
  if (e.ctrlKey && e.key === 's') {
    e.preventDefault();
    saveSceneToFile();
  }
  if (e.ctrlKey && e.key === 'o') {
    e.preventDefault();
    document.getElementById('loadScene').click();
  }
  if (e.ctrlKey && e.key === 'k') {
    e.preventDefault();
    const modal = document.querySelector('#keyboard-shortcuts-modal');
    if (modal) {
      document.body.removeChild(modal);
    } else {
      showKeyboardShortcuts();
    }
  }
  if (e.ctrlKey && e.key === 'c') {
    e.preventDefault();
    copySelectedToClipboard();
  }
  if (e.key === 'Escape') {
    selectedWrappers = [];
    highlightSelected();
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    toggleAlwaysOnTop();
  }
  if (e.key === ' ') {
    e.preventDefault();
    resetZoom();
  }
  if (e.key === 'ArrowUp') {
    scrollContainer.scrollTop -= 20;
  }
  if (e.key === 'ArrowDown') {
    scrollContainer.scrollTop += 20;
  }
  if (e.key === 'ArrowLeft') {
    scrollContainer.scrollLeft -= 20;
  }
  if (e.key === 'ArrowRight') {
    scrollContainer.scrollLeft += 20;
  }
  

}

function saveSceneToFile() {
  const state = imageData.map(w => ({
    src: w.src,
    left: parseFloat(w.wrapper.style.left),
    top: parseFloat(w.wrapper.style.top),
    width: parseFloat(w.wrapper.style.width),
    height: parseFloat(w.wrapper.style.height)
  }));
  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'reffy-scene.json';
  a.click();
  URL.revokeObjectURL(url);
  isModified = false;
}

function loadSceneFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      clearCanvas(false);
      data.forEach(img => addImageToCanvas(img.src, img.left, img.top, img.width, img.height));
      saveHistory();
    } catch (error) {
      alert('Error loading file: Invalid format');
    }
  };
  reader.onerror = () => alert('Error reading file');
  reader.readAsText(file);
}

function deleteImage(wrapper) {
  canvas.removeChild(wrapper);
  const index = imageData.findIndex(w => w.wrapper === wrapper);
  if (index !== -1) imageData.splice(index, 1);
  selectedWrappers = selectedWrappers.filter(w => w !== wrapper);
  saveHistory();
  updatePlaceholder();
  isModified = true;
}

function clearCanvas(askConfirmation = true) {
  if (askConfirmation && !confirm('Clear all images?')) return;
  canvas.innerHTML = '';
  imageData.length = 0;
  selectedWrappers = [];
  saveHistory();
  updatePlaceholder();
  isModified = true;
}

function saveHistory() {
  const state = imageData.map(w => ({
    src: w.src,
    left: parseFloat(w.wrapper.style.left),
    top: parseFloat(w.wrapper.style.top),
    width: parseFloat(w.wrapper.style.width),
    height: parseFloat(w.wrapper.style.height)
  }));

  const currentState = JSON.stringify(state);

  // Only save if the current state is different from the last state
  if (undoStack.length === 0 || currentState !== undoStack[undoStack.length - 1]) {
    undoStack.push(currentState);

    // Limit undoStack to 20 entries
    if (undoStack.length > 20) {
      undoStack.shift();
    }

    // Clear redoStack when a new change is made
    redoStack.length = 0;
  }

  localStorage.setItem('reffy-scene', currentState);
}

let isRestoring = false;

function restoreScene(json) {
  isRestoring = true;
  try {
    const data = JSON.parse(json);
    canvas.innerHTML = '';
    imageData.length = 0;
    selectedWrappers = [];
    data.forEach(img => addImageToCanvas(img.src, img.left, img.top, img.width, img.height));
    updatePlaceholder();
    updateStatusBar();
  } catch (error) {
    console.error('Error restoring scene:', error);
  }
  isRestoring = false;
}
function undo() {
  if (undoStack.length > 1) {
    // Move the current state to redoStack
    const currentState = undoStack.pop();
    redoStack.push(currentState);

    // Restore the previous state
    const previousState = undoStack[undoStack.length - 1];
    restoreScene(previousState);
    isModified = true; // Mark as modified
  }
}

function redo() {
  if (redoStack.length > 0) {
    // Move the last redo state to undoStack
    const nextState = redoStack.pop();
    undoStack.push(nextState);

    // Restore the next state
    restoreScene(nextState);
    isModified = true; // Mark as modified
  }
}

// Fixed function to update placeholder visibility
function updatePlaceholder() {
  const placeholder = document.getElementById('placeholder');
  placeholder.style.display = imageData.length ? 'none' : 'block';
}


// Enhanced zoom handler for smoother zooming
function handleZoom(e) {
  e.preventDefault();
  
  // Get mouse position relative to canvas
  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;
  
  // Get position in the document
  const scrollX = scrollContainer.scrollLeft;
  const scrollY = scrollContainer.scrollTop;
  
  // Calculate cursor position in the canvas before zoom
  const cursorXBeforeZoom = (scrollX + mouseX) / canvasScale;
  const cursorYBeforeZoom = (scrollY + mouseY) / canvasScale;
  
  // Update scale with different zoom speeds based on modifiers (like PureRef)
  let scaleAmount;
  if (e.ctrlKey) {
    // Faster zoom with Ctrl
    scaleAmount = e.deltaY * -0.002;
  } else if (e.shiftKey) {
    // Slower zoom with Shift
    scaleAmount = e.deltaY * -0.0005;
  } else {
    // Normal zoom
    scaleAmount = e.deltaY * -0.0008;
  }
  
  // Restrict scale to reasonable bounds
  const newScale = Math.min(10, Math.max(0.05, canvasScale + scaleAmount));
  
  // Apply zoom only if it changed
  if (newScale !== canvasScale) {
    canvas.style.transform = `scale(${newScale})`;
    canvas.style.transformOrigin = '0 0';
    
    // Calculate new scroll position to keep mouse over same point
    const cursorXAfterZoom = cursorXBeforeZoom * newScale;
    const cursorYAfterZoom = cursorYBeforeZoom * newScale;
    
    // Adjust scroll to keep cursor over same point
    scrollContainer.scrollLeft = cursorXAfterZoom - mouseX;
    scrollContainer.scrollTop = cursorYAfterZoom - mouseY;
    
    // Update scale value
    canvasScale = newScale;
    
    updateStatusBar();
  }
}


// Improved reset zoom function with animation
function resetZoom() {
  // Get current center of viewport
  const scrollContainer = document.querySelector('.scroll-container');
  const viewportWidth = scrollContainer.clientWidth;
  const viewportHeight = scrollContainer.clientHeight;
  const centerX = (scrollContainer.scrollLeft + viewportWidth / 2) / canvasScale;
  const centerY = (scrollContainer.scrollTop + viewportHeight / 2) / canvasScale;
  
  // Set scale to 1 with smooth transition
  canvas.style.transition = 'transform 0.3s ease-out';
  canvasScale = 1;
  canvas.style.transform = `scale(${canvasScale})`;
  
  // Recenter viewport
  scrollContainer.scrollLeft = centerX - viewportWidth / 2;
  scrollContainer.scrollTop = centerY - viewportHeight / 2;
  
  // Remove transition after animation completes
  setTimeout(() => {
    canvas.style.transition = '';
  }, 300);
  
  updateStatusBar();
}
function copySelectedToClipboard() {
  if (selectedWrappers.length === 0) return;
  
  // For simplicity, just copy the first selected image
  const wrapper = selectedWrappers[0];
  const img = wrapper.querySelector('img');
  
  // Create a canvas to draw the image
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = parseFloat(wrapper.style.width);
  canvas.height = parseFloat(wrapper.style.height);
  
  // Draw the image
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  
  // Convert to blob and copy to clipboard
  canvas.toBlob(blob => {
    const item = new ClipboardItem({ 'image/png': blob });
    navigator.clipboard.write([item]).catch(err => {
      console.error('Failed to copy image:', err);
    });
  });
}
// Show helpful keyboard shortcuts
function showKeyboardShortcuts() {
  const modal = document.createElement('div');
  modal.id = 'keyboard-shortcuts-modal';
  modal.style.position = 'fixed';
  modal.style.top = '50%';
  modal.style.left = '50%';
  modal.style.transform = 'translate(-50%, -50%)';
  modal.style.backgroundColor = 'var(--bg-darker)';
  modal.style.border = '1px solid var(--accent)';
  modal.style.padding = '20px';
  modal.style.maxWidth = '80%';
  modal.style.maxHeight = '80%';
  modal.style.overflow = 'auto';
  modal.style.zIndex = '1001';
  modal.style.color = 'var(--text)';
  modal.style.boxShadow = '0 5px 15px rgba(0,0,0,0.5)';
  modal.style.borderRadius = '4px';

  const header = document.createElement('h2');
  header.textContent = 'Keyboard Shortcuts';
  header.style.color = 'var(--accent)';
  header.style.marginBottom = '15px';
  modal.appendChild(header);

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.position = 'absolute';
  closeBtn.style.top = '10px';
  closeBtn.style.right = '10px';
  closeBtn.style.background = 'none';
  closeBtn.style.border = 'none';
  closeBtn.style.color = 'var(--text)';
  closeBtn.style.fontSize = '20px';
  closeBtn.style.cursor = 'pointer';
  closeBtn.onclick = () => document.body.removeChild(modal);
  modal.appendChild(closeBtn);

  for (const [category, shortcuts] of Object.entries(KEYBOARD_SHORTCUTS)) {
    const section = document.createElement('div');
    section.style.marginBottom = '20px';

    const categoryHeader = document.createElement('h3');
    categoryHeader.textContent = category;
    categoryHeader.style.color = 'var(--accent-hover)';
    categoryHeader.style.marginBottom = '8px';
    categoryHeader.style.borderBottom = '1px solid var(--accent-hover)';
    section.appendChild(categoryHeader);

    for (const [key, description] of Object.entries(shortcuts)) {
      const shortcut = document.createElement('div');
      shortcut.style.display = 'flex';
      shortcut.style.marginBottom = '6px';

      const keySpan = document.createElement('span');
      keySpan.textContent = key;
      keySpan.style.fontWeight = 'bold';
      keySpan.style.minWidth = '200px';
      keySpan.style.fontFamily = 'monospace';
      keySpan.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
      keySpan.style.padding = '2px 5px';
      keySpan.style.borderRadius = '3px';
      keySpan.style.marginRight = '10px';

      const descSpan = document.createElement('span');
      descSpan.textContent = description;

      shortcut.appendChild(keySpan);
      shortcut.appendChild(descSpan);
      section.appendChild(shortcut);
    }

    modal.appendChild(section);
  }

  document.body.appendChild(modal);
}

function updateStatusBar() {
  const zoomPercent = Math.round(canvasScale * 100);
  document.getElementById('zoom-level').textContent = `${zoomPercent}%`;
  document.getElementById('image-count').textContent = `${imageData.length} items`;

  if (selectedWrappers.length === 0) {
    document.getElementById('selection-info').textContent = 'No selection';
  } else if (selectedWrappers.length === 1) {
    const w = selectedWrappers[0];
    document.getElementById('selection-info').textContent = 
      `${Math.round(parseFloat(w.style.width))}×${Math.round(parseFloat(w.style.height))} @ ${Math.round(parseFloat(w.style.left))},${Math.round(parseFloat(w.style.top))}`;
  } else {
    document.getElementById('selection-info').textContent = `${selectedWrappers.length} items`;
  }
}

function toggleAlwaysOnTop() {
  isAlwaysOnTop = !isAlwaysOnTop;
  window.electronAPI.setAlwaysOnTop(isAlwaysOnTop);
  const btn = document.getElementById('stayOnTopBtn');
  btn.classList.toggle('primary', isAlwaysOnTop);
}

setInterval(() => {
  if (isModified) {
    saveHistory();
    isModified = false;
  }
}, 30000);