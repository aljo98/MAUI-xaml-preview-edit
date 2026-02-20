const fs = require('fs');
const path = 'h:/AF/maui-xaml-preview/MAUI-xaml-preview-edit/src/previewProvider.ts';
const content = fs.readFileSync(path, 'utf8').split('\n');

// We need to verify the lines.
// Line 1793 (index 1792) starts with "    private async _handleElementSelection"
// Line 1867 (index 1866) is "}"
// Line 1868 (index 1867) is ""
// Line 1869 (index 1868) is "if (element.type === 'StackLayout'..."

// I want to remove from index 1792 up to index 1866 (inclusive of the closing brace of the pasted block).
// Then I want to insert the correct logic.

const startIdx = 1792; // 0-based index for line 1793
// Find the end of the error block. The error block ends with the if statement for StackLayout which is unindented.
// Let's find "if (element.type === 'StackLayout' || element.type === 'HorizontalStackLayout') {"
// It should be around index 1868.

let endIdx = -1;
for (let i = startIdx; i < startIdx + 200; i++) {
    if (content[i] && content[i].trim().startsWith("if (element.type === 'StackLayout'")) {
        endIdx = i; // This is the start of the StackLayout block. I want to replace PREVIOUS lines.
        break;
    }
}

if (endIdx === -1) {
    console.error('Could not find end of block');
    process.exit(1);
}

// Logic to insert
const newLogic = `
        // Detect Dynamic Screen (IsVisible Binding)
        let bindingName = '';
        const isVisibleAttr = element.attributes['IsVisible'] || element.resolvedAttributes['IsVisible'];
        if (isVisibleAttr && typeof isVisibleAttr === 'string' && isVisibleAttr.includes('{Binding')) {
            // Handle "{Binding IsBusy}" and "{Binding Path=IsBusy}"
            const match = isVisibleAttr.match(/Binding\\s+(?:Path=)?([A-Za-z0-9_.]+)/);
            if (match && match[1]) {
                bindingName = match[1];
                classes.push('maui-dynamic-screen');
            }
        }
`;

// Remove lines from startIdx to endIdx - 1
// And insert newLogic
const checkLine = content[startIdx].trim();
if (!checkLine.startsWith('private async _handleElementSelection')) {
    console.error(`Line ${startIdx + 1} does not match expectation. Found: ${checkLine}`);
    process.exit(1);
}

content.splice(startIdx, endIdx - startIdx, newLogic.trim());

// Also fix indentation for the StackLayout block if it's 0-indented
// Note: endIdx is now pointing to the line *after* our insertion (because splice removed the gap).
// But splice modifies array in place.
// Wait, splice(start, deleteCount, items...).
// deleteCount = endIdx - startIdx.
// The next line is now at startIdx + 1 (if we inserted 1 line? No we inserted a string).
// If we split newLogic into lines...

const newLines = newLogic.split('\n').filter(l => l.length > 0);
content.splice(startIdx, endIdx - startIdx, ...newLines);

// Now fix indentation of subsequent lines.
// The StackLayout block starts at startIdx + newLines.length
const stackLayoutIdx = startIdx + newLines.length;

// Check if unindented
if (content[stackLayoutIdx] && !content[stackLayoutIdx].startsWith('        ')) {
    // Fix indentation for the next few lines until we see 'VerticalStackLayout' logic
    for (let i = stackLayoutIdx; i < content.length; i++) {
        const line = content[i];
        if (line.includes('// VerticalStackLayout')) break;
        if (line.trim().length > 0 && !line.startsWith('        ')) {
            content[i] = '        ' + line.trim();
        }
    }
}

fs.writeFileSync(path, content.join('\n'));
console.log('Successfully patched file');
