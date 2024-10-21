// State and constants
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const downloadButton = document.getElementById('downloadButton');
const pdfScale = 2.0;  // You can adjust the scale for higher resolution

const state = {
    allCanvases: [],
    originalFileName: '',
    fileUploaded: false,
    currentFile: null
};

let changeTimeout; // To store the timeout ID

// Utility Functions

function getMarginValues() {
    return {
        top: parseInt(document.getElementById('marginTop').value),
        right: parseInt(document.getElementById('marginRight').value),
        bottom: parseInt(document.getElementById('marginBottom').value),
        left: parseInt(document.getElementById('marginLeft').value)
    };
}

// Function to save input values to localStorage
function saveInputValues() {
    const margins = getMarginValues()
    const textColor = document.getElementById('textColor').value;
    const textOffset = document.getElementById('textOffset').value;

    // Save each value to localStorage
    localStorage.setItem('marginTop', margins.top);
    localStorage.setItem('marginRight', margins.right);
    localStorage.setItem('marginBottom', margins.bottom);
    localStorage.setItem('marginLeft', margins.left);
    localStorage.setItem('textColor', textColor);
    localStorage.setItem('textOffset', textOffset);
}

// Function to load saved input values from localStorage and set them in the inputs
function loadSavedValues() {
    // Get the saved values or use default values if none are saved
    const marginTop = localStorage.getItem('marginTop') || '60';
    const marginRight = localStorage.getItem('marginRight') || '60';
    const marginBottom = localStorage.getItem('marginBottom') || '60';
    const marginLeft = localStorage.getItem('marginLeft') || '60';
    const textColor = localStorage.getItem('textColor') || '#c1121f';  // Default to Strong Red
    const textOffset = localStorage.getItem('textOffset') || '35';

    // Set the input values based on the saved values
    document.getElementById('marginTop').value = marginTop;
    document.getElementById('marginRight').value = marginRight;
    document.getElementById('marginBottom').value = marginBottom;
    document.getElementById('marginLeft').value = marginLeft;
    document.getElementById('textColor').value = textColor;
    document.getElementById('textOffset').value = textOffset;
}

// Helper function to enable buttons
function enableButton(buttonId) {
    document.getElementById(buttonId).disabled = false;
}

// Helper function to disable buttons
function disableButton(buttonId) {
    document.getElementById(buttonId).disabled = true;
}

// Event Handlers

function handleInputChange(event) {
    saveInputValues();

    // Exclude text color changes from triggering this
    if (event.target.id !== 'textColor') {
        const pdfCanvases = document.getElementById('pdfCanvases');
        
        // Add the "changed" class to #pdfCanvases
        pdfCanvases.classList.add('changed');

        // Clear any existing timeout
        if (changeTimeout) {
            clearTimeout(changeTimeout);
        }

        // Set a timeout to remove the "changed" class after 1 second of inactivity
        changeTimeout = setTimeout(() => {
            pdfCanvases.classList.remove('changed');
        }, 2000);
    }

    if (state.currentFile) {
        state.allCanvases.forEach((originalCanvas, index) => {
            const marginCanvas = originalCanvas.nextSibling.nextSibling;
            
            // Clear the overlay canvas before redrawing margins
            const marginContext = marginCanvas.getContext('2d');
            marginContext.clearRect(0, 0, marginCanvas.width, marginCanvas.height);
            
            drawMargins(marginCanvas);
        });
        enableButton('updateButton');
    }
}

function handleFileUpload(file) {
    const { getDocument } = pdfjsLib;
    const fileReader = new FileReader();

    // Extract the original filename without extension
    state.originalFileName = file.name.split('.').slice(0, -1).join('.');

    fileReader.onload = async function(e) {
        const arrayBuffer = e.target.result;
        const pdf = await getDocument({ data: arrayBuffer }).promise;
        const totalPages = pdf.numPages;

        // Clear all contents from the #pdfCanvases div
        const pdfCanvasesDiv = document.getElementById('pdfCanvases');
        pdfCanvasesDiv.innerHTML = '';  // Remove all children

        // Clear the previous canvases (if any)
        state.allCanvases = [];

        for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
            await renderPage(pdf, pageNumber);
        }

        // Enable the download button after rendering is complete
        enableButton('downloadButton');
    };

    // Read the file as an ArrayBuffer so we can pass it to PDF.js
    fileReader.readAsArrayBuffer(file);
}

function handleFileSelection(event) {
    const file = event.target.files[0];
    if (file && file.type === 'application/pdf') {
        state.currentFile = file;
        handleFileUpload(file);
    }
}

function handleDrop(e) {
    const dt = e.dataTransfer;
    const file = dt.files[0];

    if (file && file.type === 'application/pdf') {
        state.currentFile = file;
        handleFileUpload(file);
    } else {
        console.error('Please upload a valid PDF file.');
    }
}

// PDF Processing Functions

function computeRowSums(imageData, width, height) {
    const pixelData = imageData.data;  // Uint8ClampedArray containing the RGBA values
    const rowSums = [];

    const margins = getMarginValues();
    const marginTop = margins.top;
    const marginRight = margins.right;
    const marginBottom = margins.bottom;
    const marginLeft = margins.left;

    for (let row = 0; row < height; row++) {
        if (row < marginTop || row >= height - marginBottom) {
            rowSums.push(0);  // Skip rows in the top and bottom margins
            continue;
        }

        let rowSum = 0;
        for (let col = marginLeft; col < width - marginRight; col++) {
            const pixelIndex = (row * width + col) * 4;  // Get the index of the pixel in the flat array
            const r = pixelData[pixelIndex];     // Red component (0 to 255)
            const g = pixelData[pixelIndex + 1]; // Green component (0 to 255)
            const b = pixelData[pixelIndex + 2]; // Blue component (0 to 255)
            const a = pixelData[pixelIndex + 3]; // Alpha component (0 to 255)

            const weightedValue = 255 * a - (0.299 * r + 0.587 * g + 0.114 * b) * a;
            rowSum += weightedValue;
        }
        rowSums.push(rowSum);
    }

    return rowSums;
}

function normalizeRowSums(rowSums, maxNormValue = 50) {
    const maxSum = Math.max(...rowSums);
            
    // Handle case where all sums are 0
    if (maxSum === 0) {
        return rowSums;  // No normalization needed if every entry is 0
    }

    // Normalize rowSums so that the maximum value becomes maxNormValue
    return rowSums.map(sum => (sum / maxSum) * maxNormValue);
}

function processRowSums(rowSums) {
    const results = [];
    let k = 0;
    const rowCount = rowSums.length;

    // Ensure all values in rowSums are integers
    rowSums = rowSums.map(Math.round);

    while (k < rowCount) {
        // Step 1: Find the first index i >= k such that rowSums[i] is positive
        let i = k;
        while (i < rowCount && rowSums[i] <= 0) {
            i++;
        }

        // If no such index exists, break the loop
        if (i >= rowCount) {
            break;
        }

        // Step 2: Find the next index j >= i such that rowSums[j+1] is 0
        let j = i;
        while (j + 1 < rowCount && rowSums[j + 1] > 0) {
            j++;
        }

        // If j + 1 exceeds the limit, let j be the last index
        if (j + 1 >= rowCount) {
            j = rowCount - 1;
        }

        // Step 3: If j > i + 10, compute the average
        if (j > i + 10) {
            let weightedSum = 0;
            let rowSumTotal = 0;

            // Calculate the sum of y * rowSums[l] and the total of rowSums[l] for l from i to j inclusive
            for (let l = i; l <= j; l++) {
                weightedSum += l * rowSums[l];
                rowSumTotal += rowSums[l];  // Sum of rowSums[l] over the range
            }

            // Compute the average, dividing by the total sum of rowSums[l]
            const average = weightedSum / rowSumTotal;
            results.push(average);  // Add the average and index to the results array
        }

        // Step 4: Set k = j and continue the loop
        k = j + 1;
    }

    return results;  // Return the array of averages
}

// Rendering Functions

async function renderPage(pdf, pageNumber) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: pdfScale });

    const { containerDiv, originalCanvas, overlayCanvas, marginCanvas } = setupCanvas(viewport);

    // Render the page on the original canvas
    await renderBitmap(page, originalCanvas, viewport);

    // Append the new div to the document body (or any other container)
    document.getElementById('pdfCanvases').appendChild(containerDiv);

    // Add the original canvas to the state.allCanvases array for PDF generation
    state.allCanvases.push(originalCanvas);

    // Process the canvases (rowSums, overlay, etc.)
    processCanvases(originalCanvas, overlayCanvas, marginCanvas, pageNumber);
}

function setupCanvas(viewport) {
    // Create a new div to contain both the original and overlay canvases
    const containerDiv = document.createElement('div');
    containerDiv.className = 'container-div';

    // Create the original canvas for rendering the page
    const originalCanvas = document.createElement('canvas');
    originalCanvas.width = viewport.width;
    originalCanvas.height = viewport.height;

    // Create the overlay canvas (positioned over the original canvas)
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.className = 'overlay-canvas';
    overlayCanvas.width = viewport.width + 100;
    overlayCanvas.height = viewport.height;

    // Create the margin canvas (positioned over the original canvas)
    const marginCanvas = document.createElement('canvas');
    marginCanvas.className = 'margin-canvas';
    marginCanvas.width = viewport.width;
    marginCanvas.height = viewport.height;

    // Append all canvases to the div
    containerDiv.appendChild(originalCanvas);
    containerDiv.appendChild(overlayCanvas);
    containerDiv.appendChild(marginCanvas);

    // Return the elements
    return { containerDiv, originalCanvas, overlayCanvas, marginCanvas };
}

async function renderBitmap(page, originalCanvas, viewport) {
    const context = originalCanvas.getContext('2d');

    // Render the page on the original canvas
    const renderContext = {
        canvasContext: context,
        viewport: viewport
    };
    await page.render(renderContext).promise;
}

function processCanvases(originalCanvas, overlayCanvas, marginCanvas, pageNumber) {
    const context = originalCanvas.getContext('2d');
    const bitmap = context.getImageData(0, 0, originalCanvas.width, originalCanvas.height);
    const rowSums = computeRowSums(bitmap, originalCanvas.width, originalCanvas.height);
    const normalizedRowSums = normalizeRowSums(rowSums, 50);

    drawNormalizedRowSums(overlayCanvas, normalizedRowSums);
    const averages = processRowSums(rowSums);
    drawTextFromAverages(originalCanvas, averages, pageNumber);

    drawMargins(marginCanvas);
}

function drawNormalizedRowSums(overlayCanvas, normalizedRowSums) {
    const context = overlayCanvas.getContext('2d');
    const canvasWidth = overlayCanvas.width;
    context.strokeStyle = '#ddd';
    context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);  // Clear only the overlay canvas

    for (let r = 0; r < normalizedRowSums.length; r++) {
        const rowSum = normalizedRowSums[r];

        // Draw a horizontal line of length rowSum, aligned to the right
        context.beginPath();
        
        // Start at the right edge of the canvas and subtract rowSum to get the left end of the line
        context.moveTo(overlayCanvas.width - 50, r);
        context.lineTo(overlayCanvas.width - 50 + rowSum, r);

        context.stroke();
    }
}

function drawTextFromAverages(overlayCanvas, averages, pageNumber) {
    const context = overlayCanvas.getContext('2d');
    const canvasWidth = overlayCanvas.width;
    
    // Get the text offset and color from inputs
    const textOffset = parseInt(document.getElementById('textOffset').value) || 35;
    const textColor = document.getElementById('textColor').value;
    
    context.font = '12px Courier';  // Set the font size and family
    context.textAlign = 'right';  // Align text to the right (horizontally)
    context.textBaseline = 'middle';  // Vertically align text to the middle
    context.fillStyle = textColor;  // Set the chosen text color

    averages.forEach((average, index) => {
        const y = average;  // The y position from the top
        const text = `${pageNumber}.${index + 1}`;  // Format the text as "p.q", where p is the page number

        // Calculate the x position, 60 pixels from the right edge
        const x = canvasWidth - textOffset;

        // Draw the text (p.q) at position (x, y)
        context.fillText(text, x, y);
    });
}

function drawMargins(marginCanvas) {
    const context = marginCanvas.getContext('2d');
    const width = marginCanvas.width;
    const height = marginCanvas.height;

    // Get the margin values from the inputs
    const margins = getMarginValues();
    const marginTop = margins.top;
    const marginRight = margins.right;
    const marginBottom = margins.bottom;
    const marginLeft = margins.left;
    const textOffset = parseInt(document.getElementById('textOffset').value); // Get the text offset value

    // Set the style for the ignored margin areas
    context.fillStyle = 'rgba(252, 110, 116, 0.4)';  // Semi-transparent red

    // Draw top margin rectangle
    context.fillRect(0, 0, width, marginTop);

    // Draw bottom margin rectangle
    context.fillRect(0, height - marginBottom, width, marginBottom);

    // Draw left margin rectangle (excluding top and bottom margin areas)
    context.fillRect(0, marginTop, marginLeft, height - marginTop - marginBottom);

    // Draw right margin rectangle (excluding top and bottom margin areas)
    context.fillRect(width - marginRight, marginTop, marginRight, height - marginTop - marginBottom);

    // Draw dashed line textOffset px to the right of the canvas
    context.strokeStyle = 'rgba(0, 0, 0, 0.5)';  // Darker color for dashed line
    context.lineWidth = 2;
    context.setLineDash([5, 5]);  // Dashed line pattern: 5px dash, 5px gap

    // Draw the dashed line from the top to the bottom, textOffset px from the right
    const xPosition = width - textOffset;  // x-position of the dashed line
    context.beginPath();
    context.moveTo(xPosition, 0);  // Start at the top of the canvas
    context.lineTo(xPosition, height);  // End at the bottom of the canvas
    context.stroke();

    // Reset the line dash pattern
    context.setLineDash([]);
}

// PDF Generation Function

function downloadMultiPagePDF(canvases) {
    const { jsPDF } = window.jspdf;

    // Disable the download button while generating the PDF
    disableButton('downloadButton');
    document.getElementById('downloadButton').innerText = 'Downloading...';  // Optional: Update the button text

    setTimeout(() => {  // Use a timeout to allow UI updates
        // Initialize the jsPDF instance without specifying a fixed page size
        let pdf = null;

        canvases.forEach((canvas, index) => {
            const imgData = canvas.toDataURL('image/png');
            
            // Get the canvas width and height in pixels
            const canvasWidth = canvas.width;
            const canvasHeight = canvas.height;

            // Convert canvas dimensions from pixels to points (1 point = 1/72 inch)
            const pageWidth = canvasWidth * 0.264583 * pdfScale;
            const pageHeight = canvasHeight * 0.264583 * pdfScale;

            // Create or add a new page to the PDF using canvas dimensions
            if (index === 0) {
                // Initialize jsPDF with the size of the first canvas
                pdf = new jsPDF({
                    orientation: 'portrait',
                    unit: 'pt',  // Using points to match canvas dimensions
                    format: [pageWidth, pageHeight]  // Set PDF page size to match canvas size
                });
            } else {
                // For subsequent pages, add a new page with the same dimensions
                pdf.addPage([pageWidth, pageHeight]);
            }

            // Add the canvas image to the PDF
            pdf.addImage(imgData, 'PNG', 0, 0, pageWidth, pageHeight);
        });

        // Get the current date in YYYYMMDD format
        const currentDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');

        // Create the final filename with original filename + date
        const finalFilename = `${state.originalFileName}-${currentDate}.pdf`;

        // Trigger the download of the PDF
        if (pdf) {
            pdf.save(finalFilename);
        }

        // Re-enable the download button and reset the button text
        enableButton('downloadButton');
        document.getElementById('downloadButton').innerText = 'Download';  // Reset button text

    }, 500);  // A small delay to allow UI to update before processing
}

// Scroll Event Handler

// Function to toggle the fixed header based on scroll position
function toggleFixedHeader() {
    const header = document.getElementById('mainHeader');

    // Check if the scroll position is beyond 100px
    if (window.scrollY > 342) {
        header.classList.add('fixed');
        document.body.classList.add('fixed-header');
    } else {
        header.classList.remove('fixed');
        document.body.classList.remove('fixed-header');
    }
}

// Attach Event Listeners

function attachEvents() {
    // Prevent default behavior (Prevent file from being opened in the browser)
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    // Highlight the drop zone when dragging over it
    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.add('highlight'), false);
    });

    // Unhighlight when the drag leaves the drop zone
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => dropZone.classList.remove('highlight'), false);
    });

    // Handle the drop event
    dropZone.addEventListener('drop', handleDrop, false);

    // Trigger the hidden file input when the user clicks on the drop zone
    dropZone.addEventListener('click', () => fileInput.click(), false);

    // Handle file selection via the hidden file input
    fileInput.addEventListener('change', handleFileSelection, false);

    // Add event listeners to save input values to localStorage
    document.getElementById('marginTop').addEventListener('input', handleInputChange);
    document.getElementById('marginRight').addEventListener('input', handleInputChange);
    document.getElementById('marginBottom').addEventListener('input', handleInputChange);
    document.getElementById('marginLeft').addEventListener('input', handleInputChange);
    document.getElementById('textColor').addEventListener('input', handleInputChange);
    document.getElementById('textOffset').addEventListener('input', handleInputChange);

    // Add event listener for the "Update" button
    document.getElementById('updateButton').addEventListener('click', () => {
        handleFileUpload(state.currentFile);  // Trigger file upload with the current file
        disableButton('updateButton');
    });

    // Add event listener for the "Download" button
    document.getElementById('downloadButton').addEventListener('click', () => {
        if (state.allCanvases.length > 0) {
            downloadMultiPagePDF(state.allCanvases);  // Download PDF with all canvases
        } else {
            console.error('No canvases to download');
        }
    });

    // Attach the scroll event listener
    window.addEventListener('scroll', toggleFixedHeader);
}

// Initialize

document.addEventListener('DOMContentLoaded', () => {
    // Load saved values from localStorage when the page is loaded
    loadSavedValues();

    // Attach all event listeners
    attachEvents();
});
