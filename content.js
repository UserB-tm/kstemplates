console.log("content.js loaded on page:", window.location.href);

// Keep track of the last active editor element
let lastActiveEditor = null;
// Set up a recurring check to maintain monitoring
let monitoringInterval = null;
// Track recent template insertions to prevent duplicates
let recentInsertions = {};
// Prevent simultaneous shortcut processing
let processingShortcut = false;

// Function to check the current state of the editor
function checkEditorState() {
  const activeElement = document.activeElement;
  
  // Look for Outlook email editor elements even if they're not the active element
  const possibleEditors = document.querySelectorAll('[contenteditable="true"]');
  
  if (activeElement.isContentEditable && !lastActiveEditor) {
    console.log("Editor found and now being monitored:", activeElement.className);
    lastActiveEditor = activeElement;
    // Make sure we're monitoring keyboard events
    ensureKeyboardMonitoring();
  }
  
  // Monitor all possible editor elements to make sure we don't miss any
  possibleEditors.forEach(editor => {
    // Add our marker to track this element if we haven't already
    if (!editor.hasAttribute('data-ks-monitored')) {
      console.log("Setting up event monitoring for editor:", editor.className);
      
      // Mark this element as being monitored
      editor.setAttribute('data-ks-monitored', 'true');
      
      // Attach specific event listeners directly to this editor element
      editor.addEventListener("keydown", handleEditorKeydown);
      editor.addEventListener("input", handleEditorInput);
      editor.addEventListener("focus", () => {
        console.log("Editor focused:", editor.className);
        lastActiveEditor = editor;
      });
    }
  });
}

// Function to handle keydown events in the editor
function handleEditorKeydown(e) {
  console.log("Editor keydown:", e.key);
  
  // If we're already processing a shortcut, don't send more events
  if (processingShortcut) return;
  
  chrome.runtime.sendMessage({ 
    type: "keydown", 
    key: e.key,
    elementType: e.target.tagName,
    isContentEditable: e.target.isContentEditable,
    className: e.target.className
  });
  
  // Keep track of the last few keystrokes in a buffer
  updateLocalBuffer(e.key);
}

// Function to handle input events in the editor
function handleEditorInput(e) {
  // If we're already processing a shortcut, don't send more events
  if (processingShortcut) return;
  
  const text = e.target.innerText || e.target.textContent;
  const lastChars = text ? text.slice(-20) : "";
  
  console.log("Editor input event, last chars:", lastChars);
  chrome.runtime.sendMessage({ 
    type: "inputChange", 
    text: lastChars,
    elementType: e.target.tagName,
    isContentEditable: e.target.isContentEditable,
    className: e.target.className
  });
}

// Local keystroke buffer for redundancy
let localKeyBuffer = "";
function updateLocalBuffer(key) {
  // Only add printable characters to the buffer
  if (key.length === 1 || key === "Enter" || key === "Tab" || key === " ") {
    localKeyBuffer += key;
    // Keep buffer a reasonable size
    if (localKeyBuffer.length > 20) {
      localKeyBuffer = localKeyBuffer.slice(-20);
    }
    
    // Check for template shortcut matches locally as well
    checkForLocalShortcuts(localKeyBuffer);
  }
}

// Function to check for shortcuts locally
function checkForLocalShortcuts(buffer) {
  // If we're already processing a shortcut, don't start another
  if (processingShortcut) return;
  
  // Known shortcuts - you could fetch these from storage for more dynamic handling
  const knownShortcuts = ["\\wsd", "\\lbj"];
  
  // Check if buffer ends with any known shortcut
  for (const shortcut of knownShortcuts) {
    if (buffer.endsWith(shortcut)) {
      // Check if we've recently processed this shortcut to prevent duplicates
      const now = Date.now();
      if (recentInsertions[shortcut] && now - recentInsertions[shortcut] < 2000) {
        console.log("Skipping duplicate shortcut detection:", shortcut);
        return;
      }
      
      console.log("Local shortcut match detected:", shortcut);
      // Set processing flag to prevent concurrent processing
      processingShortcut = true;
      // Record this insertion to prevent duplicates
      recentInsertions[shortcut] = now;
      
      // Send a message to request the corresponding template
      chrome.runtime.sendMessage({ 
        type: "shortcutDetected", 
        shortcut: shortcut 
      });
      
      // Clear processing flag after a delay
      setTimeout(() => {
        processingShortcut = false;
      }, 1000);
      
      break;
    }
  }
}

// Function to ensure keyboard events are being monitored
function ensureKeyboardMonitoring() {
  if (!monitoringInterval) {
    console.log("Setting up persistent monitoring interval");
    // Check editor state regularly to ensure we're still monitoring
    monitoringInterval = setInterval(checkEditorState, 2000);
    
    // Also check whenever the window gains focus
    window.addEventListener("focus", checkEditorState);
  }
}

// Handle subject line keystrokes with keydown
document.addEventListener("keydown", (e) => {
  const activeElement = document.activeElement;
  
  // Check if this is the keyboard shortcut to open the popup
  if (e.ctrlKey && e.shiftKey && e.key === "E") {
    console.log("Keyboard shortcut detected: Ctrl+Shift+E");
    // Send message to open popup
    chrome.runtime.sendMessage({ type: "openPopup" });
    // Prevent default to avoid potential conflicts
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  
  if (activeElement.tagName === "INPUT" || activeElement.tagName === "TEXTAREA") {
    console.log("Sending key from input field:", e.key);
    chrome.runtime.sendMessage({ type: "keydown", key: e.key });
  }
  
  // Outlook's editable divs are handled by the specific editor listeners
});

// Set up the MutationObserver to detect when the email editor is added to the page
const observer = new MutationObserver((mutations) => {
  let editorFound = false;
  
  for (const mutation of mutations) {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      // Check if any added nodes might be our editor
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Look for contenteditable elements
          const editors = node.querySelectorAll('[contenteditable="true"]');
          if (editors.length > 0) {
            editorFound = true;
            console.log("Editor elements found:", editors.length);
            
            // Make sure we're monitoring keyboard events
            checkEditorState();
          }
        }
      });
    }
  }
});

// Start observing the document body for added nodes
observer.observe(document.body, { childList: true, subtree: true });

// Periodically check for the editor even if the mutation observer misses it
setTimeout(checkEditorState, 1000);
setTimeout(checkEditorState, 3000);
setTimeout(checkEditorState, 10000);

// Insert templates when instructed by background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "insertTemplate") {
    // Check if we've recently inserted this template to prevent duplicates
    const now = Date.now();
    if (message.shortcut && recentInsertions[message.shortcut] && 
        now - recentInsertions[message.shortcut] < 1500) {
      console.log("Skipping duplicate template insertion for:", message.shortcut);
      return;
    }
    
    const activeElement = document.activeElement;
    console.log("Insert template request for element:", 
                activeElement.tagName,
                "contentEditable:", activeElement.isContentEditable,
                "className:", activeElement.className);
    
    // Find the editor element - either active element or last known editor
    const targetElement = activeElement.isContentEditable ? 
                         activeElement : 
                         lastActiveEditor || document.querySelector('[contenteditable="true"]');
    
    if (targetElement) {
      console.log("Inserting template:", message.content.substring(0, 50) + "...");
      
      // Store the current selection range
      const selection = window.getSelection();
      let range = null;
      
      if (selection.rangeCount > 0) {
        range = selection.getRangeAt(0);
        
        // If we have a shortcut that triggered this, remove it
        if (message.shortcut) {
          // Record this insertion to prevent duplicates
          recentInsertions[message.shortcut] = now;
          
          // Get the text of the selection's container
          const containerText = range.startContainer.textContent;
          const shortcutPos = containerText.lastIndexOf(message.shortcut);
          
          if (shortcutPos >= 0) {
            // Create a range to select just the shortcut text
            const shortcutRange = document.createRange();
            shortcutRange.setStart(range.startContainer, shortcutPos);
            shortcutRange.setEnd(range.startContainer, shortcutPos + message.shortcut.length);
            
            // Delete the shortcut text
            shortcutRange.deleteContents();
            
            // Update our insertion range
            range = shortcutRange;
          }
        }
        
        // Create a temporary element with the template content
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = message.content;
        
        // Insert each child of the temp div
        while (tempDiv.firstChild) {
          range.insertNode(tempDiv.firstChild);
          range.collapse(false); // Move to the end of the inserted content
        }
        
        // Dispatch an 'input' event to ensure changes are registered
        const inputEvent = new Event('input', { bubbles: true });
        targetElement.dispatchEvent(inputEvent);
      } else {
        // Fallback method if no range is available
        targetElement.focus();
        
        // Create a temporary element with the template content
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = message.content;
        
        // Insert each child of the temp div
        while (tempDiv.firstChild) {
          targetElement.appendChild(tempDiv.firstChild);
        }
      }
      
      // Clear our local buffer after template insertion
      localKeyBuffer = "";
    } else {
      console.log("No compatible element found for template insertion");
    }
  }
});

// Initial check for the editor
checkEditorState();

// Log that we're fully loaded and monitoring
console.log("KS Templates content script initialized and monitoring for events");