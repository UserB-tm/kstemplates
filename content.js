console.log("content.js loaded on page:", window.location.href);

// Keep track of the last active editor element
let lastActiveEditor = null;
// Set up a recurring check to maintain monitoring
let monitoringInterval = null;
// Track recent template insertions to prevent duplicates
let recentInsertions = {};
// Prevent simultaneous shortcut processing
let processingShortcut = false;
// Store the current domain
const currentDomain = window.location.hostname;
console.log("Current domain:", currentDomain);

// Detect if we're on Office365 Outlook
const isOffice365 = currentDomain.includes("outlook.office");
console.log("Is Office365:", isOffice365);

// Function to check the current state of the editor
function checkEditorState() {
  const activeElement = document.activeElement;
  
  // Enhanced selector for Outlook email editor elements
  // This adds specific selectors for outlook.office.com
  const possibleEditors = document.querySelectorAll(
    '[contenteditable="true"], ' + 
    '[role="textbox"], ' + 
    '[aria-label*="message"], ' +
    '[aria-label*="Message"], ' +
    '.editorWrapper [contenteditable="true"], ' +
    '.Compose [contenteditable="true"]'
  );
  
  console.log("Found possible editors:", possibleEditors.length);
  
  if (activeElement.isContentEditable && !lastActiveEditor) {
    console.log("Editor found and now being monitored:", activeElement.tagName, activeElement.className);
    lastActiveEditor = activeElement;
    // Make sure we're monitoring keyboard events
    ensureKeyboardMonitoring();
  }
  
  // Monitor all possible editor elements to make sure we don't miss any
  possibleEditors.forEach(editor => {
    // Add our marker to track this element if we haven't already
    if (!editor.hasAttribute('data-ks-monitored')) {
      console.log("Setting up event monitoring for editor:", editor.tagName, editor.className);
      editor.setAttribute('data-ks-monitored', 'true');
      
      // Use the capture phase to ensure we get events before they might be stopped
      editor.addEventListener("keydown", handleEditorKeydown, true);
      editor.addEventListener("input", handleEditorInput, true);
      editor.addEventListener("focus", () => {
        console.log("Editor focused:", editor.tagName, editor.className);
        lastActiveEditor = editor;
      });

      // For Office365, add extra monitoring on parent elements
      if (isOffice365) {
        const parentElement = editor.parentElement;
        if (parentElement && !parentElement.hasAttribute('data-ks-parent-monitored')) {
          console.log("Setting up parent monitoring for Office365");
          parentElement.setAttribute('data-ks-parent-monitored', 'true');
          parentElement.addEventListener("keydown", handleEditorKeydown, true);
          parentElement.addEventListener("input", handleEditorInput, true);
        }
      }
    }
  });

  // For Office365, also monitor the document for keydown events
  if (isOffice365 && !document.body.hasAttribute('data-ks-doc-monitored')) {
    document.body.setAttribute('data-ks-doc-monitored', 'true');
    document.addEventListener("keydown", (e) => {
      // Only process if we have an active editor
      if (lastActiveEditor || document.querySelector('[contenteditable="true"]')) {
        console.log("Document-level keydown in Office365:", e.key);
        handleEditorKeydown(e);
      }
    }, true);
  }
}

// Function to handle keydown events in the editor
function handleEditorKeydown(e) {
  // Log with more detailed information about the event target
  console.log("Editor keydown:", e.key, 
              "Target:", e.target.tagName, 
              "ContentEditable:", e.target.isContentEditable,
              "Class:", e.target.className);
  
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
  
  // Get text content in multiple ways to ensure we capture it
  let text = "";
  if (e.target.value) {
    text = e.target.value;
  } else if (e.target.innerText) {
    text = e.target.innerText;
  } else if (e.target.textContent) {
    text = e.target.textContent;
  }
  
  // Special handling for Office365
  if (isOffice365 && lastActiveEditor) {
    // Try to get text from the last active editor if the event target doesn't have text
    if (!text) {
      text = lastActiveEditor.innerText || lastActiveEditor.textContent || "";
    }
    
    // For Office365, also check if we can get the selection's text
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      if (range.startContainer.nodeType === Node.TEXT_NODE) {
        // Get text from the current text node
        text = range.startContainer.textContent || "";
      }
    }
  }
  
  const lastChars = text ? text.slice(-30) : "";
  
  console.log("Editor input event, target:", e.target.tagName, "class:", e.target.className);
  console.log("Editor input event, last chars:", lastChars);
  
  chrome.runtime.sendMessage({ 
    type: "inputChange", 
    text: lastChars,
    elementType: e.target.tagName,
    isContentEditable: e.target.isContentEditable,
    className: e.target.className
  });
  
  // Also check local buffer for shortcuts - in case message sending fails
  checkForLocalShortcuts(lastChars);
}

// Local keystroke buffer for redundancy - enhanced for Office365
let localKeyBuffer = "";
function updateLocalBuffer(key) {
  // Only add printable characters to the buffer
  if (key.length === 1 || key === "Enter" || key === "Tab" || key === " ") {
    localKeyBuffer += key;
    // Keep buffer a reasonable size
    if (localKeyBuffer.length > 30) {
      localKeyBuffer = localKeyBuffer.slice(-30);
    }
    
    console.log("Local key buffer updated:", localKeyBuffer);
    
    // Check for template shortcut matches locally as well
    checkForLocalShortcuts(localKeyBuffer);
  }
}

// Enhanced function to check for shortcuts locally
function checkForLocalShortcuts(buffer) {
  // If we're already processing a shortcut, don't start another
  if (processingShortcut) return;
  
  // Get shortcuts dynamically from IndexedDB for more robust handling
  openDB().then(db => {
    const transaction = db.transaction(["templates"], "readonly");
    const store = transaction.objectStore("templates");
    const request = store.getAll();
    
    request.onsuccess = () => {
      const templates = request.result;
      const shortcuts = templates.map(t => t.shortcut);
      
      console.log("Checking buffer for shortcuts:", buffer, "Available shortcuts:", shortcuts);
      
      // Check if buffer ends with any known shortcut
      for (const shortcut of shortcuts) {
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
    };
  }).catch(error => {
    console.error("Error fetching shortcuts from DB:", error);
  });
}

// Function to open the IndexedDB database
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("KSTemplatesDB", 2);
    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = (event) => reject(event.target.error);
  });
}

// Function to ensure keyboard events are being monitored
function ensureKeyboardMonitoring() {
  if (!monitoringInterval) {
    console.log("Setting up persistent monitoring interval");
    // Check editor state more frequently for better reliability
    monitoringInterval = setInterval(checkEditorState, 1000);
    
    // Also check whenever the window gains focus
    window.addEventListener("focus", checkEditorState);
    
    // For Office365, also check on mouse clicks
    if (isOffice365) {
      document.addEventListener("click", () => {
        console.log("Click detected, checking editor state");
        setTimeout(checkEditorState, 100);
      });
    }
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
  
  // For Office365, also check if we need to update our buffer
  if (isOffice365 && (lastActiveEditor || document.querySelector('[contenteditable="true"]'))) {
    updateLocalBuffer(e.key);
  }
});

// Enhanced MutationObserver with specific options for Outlook.Office
const observerOptions = {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['contenteditable', 'role', 'aria-label']
};

// Set up the MutationObserver to detect when the email editor is added to the page
const observer = new MutationObserver((mutations) => {
  let editorFound = false;
  
  for (const mutation of mutations) {
    if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
      // Check if any added nodes might be our editor
      mutation.addedNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Enhanced selector for contenteditable elements
          const editors = node.querySelectorAll(
            '[contenteditable="true"], ' + 
            '[role="textbox"], ' +
            '[aria-label*="message"], ' + 
            '[aria-label*="Message"], ' +
            '.editorWrapper [contenteditable="true"], ' +
            '.Compose [contenteditable="true"]'
          );
          
          if (editors.length > 0) {
            editorFound = true;
            console.log("Editor elements found:", editors.length);
            
            // Make sure we're monitoring keyboard events
            checkEditorState();
          }
        }
      });
    } else if (mutation.type === 'attributes') {
      // Check if the attribute change made this element editable
      if (mutation.target.isContentEditable || 
          mutation.target.getAttribute('role') === 'textbox' ||
          mutation.target.getAttribute('aria-label')?.includes('message')) {
        console.log("Element became editable via attribute change");
        checkEditorState();
      }
    }
  }
});

// Start observing the document body for added nodes with enhanced options
observer.observe(document.body, observerOptions);

// More aggressive initial checks for editor elements
checkEditorState();
// Check more frequently initially
setTimeout(checkEditorState, 500);
setTimeout(checkEditorState, 1000);
setTimeout(checkEditorState, 2000);
setTimeout(checkEditorState, 5000);
setTimeout(checkEditorState, 10000);

// Enhanced template insertion for Office365
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
    
    // Enhanced target selection for Office365
    let targetElement = null;
    
    if (activeElement.isContentEditable) {
      targetElement = activeElement;
    } else if (lastActiveEditor) {
      targetElement = lastActiveEditor;
    } else {
      // More aggressive editor detection for Office365
      const editors = document.querySelectorAll(
        '[contenteditable="true"], ' + 
        '[role="textbox"], ' +
        '[aria-label*="message"], ' + 
        '[aria-label*="Message"], ' +
        '.editorWrapper [contenteditable="true"], ' +
        '.Compose [contenteditable="true"]'
      );
      
      if (editors.length > 0) {
        targetElement = editors[0];
        console.log("Found editor through enhanced detection");
      }
    }
    
    if (targetElement) {
      console.log("Inserting template into:", targetElement.tagName, targetElement.className);
      console.log("Template preview:", message.content.substring(0, 50) + "...");
      
      // Store the current selection range
      const selection = window.getSelection();
      let range = null;
      
      if (selection.rangeCount > 0) {
        range = selection.getRangeAt(0);
        
        // If we have a shortcut that triggered this, remove it
        if (message.shortcut) {
          // Record this insertion to prevent duplicates
          recentInsertions[message.shortcut] = now;
          
          try {
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
          } catch (error) {
            console.error("Error removing shortcut:", error);
            // Continue with insertion even if shortcut removal fails
          }
        }
        
        try {
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
          
          console.log("Template insertion complete");
        } catch (error) {
          console.error("Error inserting template:", error);
          
          // Fallback method for Office365
          if (isOffice365) {
            try {
              console.log("Trying fallback insertion method for Office365");
              // Focus the element first
              targetElement.focus();
              
              // Try execCommand as a fallback
              document.execCommand('insertHTML', false, message.content);
              
              console.log("Fallback insertion method completed");
            } catch (fallbackError) {
              console.error("Fallback insertion also failed:", fallbackError);
            }
          }
        }
      } else {
        // Fallback method if no range is available
        console.log("No selection range available, using fallback insertion");
        targetElement.focus();
        
        try {
          // First try execCommand (works in some browsers)
          if (document.execCommand('insertHTML', false, message.content)) {
            console.log("Template inserted with execCommand");
          } else {
            // Otherwise fall back to appendChild
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = message.content;
            
            // Insert each child of the temp div
            while (tempDiv.firstChild) {
              targetElement.appendChild(tempDiv.firstChild);
            }
            console.log("Template inserted with appendChild");
          }
        } catch (error) {
          console.error("Error with fallback insertion:", error);
        }
      }
      
      // Clear our local buffer after template insertion
      localKeyBuffer = "";
    } else {
      console.log("No compatible element found for template insertion");
    }
  } else if (message.type === "openPopup") {
    console.log("Received request to open popup");
  }
  
  return true;
});

// Initial check for the editor
checkEditorState();

// Log that we're fully loaded and monitoring
console.log("KS Templates content script initialized and monitoring for events");