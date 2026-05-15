/**
 * XAML Completion Provider for MAUI
 * Provides IntelliSense-like suggestions for XAML editing
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CSharpParser } from './csharpParser';
import { BindingResolver, BindingContext } from './bindingResolver';
import { 
    ALL_CONTROLS, 
    FLOWORKS_CUSTOM_CONTROLS,
    getAllElementSuggestions, 
    getPropertySuggestions,
    getAttachedPropertySuggestions,
    getBindingSuggestionsFromViewModel,
    FLOWORKS_VIEWMODEL_BASE_PROPERTIES,
    SchemaProperty
} from './mauiSchema';

export class MauiCompletionProvider implements vscode.CompletionItemProvider {
    
    private _completionItems: Map<string, vscode.CompletionItem[]> = new Map();
    private _bindingContextCache: Map<string, BindingContext> = new Map();
    
    // Trigger characters
    private static readonly TRIGGER_CHARS = ['<', ' ', '.', '{', ':'];
    private static readonly PROPERTY_TRIGGER_CHARS = [' ', '='];

    constructor() {}

    /**
     * Provide completion items
     */
    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.CompletionItem[] | Thenable<vscode.CompletionItem[]> {
        const line = document.lineAt(position.line).text;
        const textBefore = line.substring(0, position.character);
        
        // Determine what we're completing based on context
        if (this.isInsideBinding(textBefore)) {
            return this.provideBindingCompletions(document, position);
        } else if (this.isInsideResource(textBefore)) {
            return this.provideResourceCompletions(document, position);
        } else if (this.isCompletingElement(textBefore)) {
            return this.provideElementCompletions(document, position);
        } else if (this.isCompletingAttribute(textBefore, position, document)) {
            return this.provideAttributeCompletions(document, position);
        } else if (this.isCompletingAttachedProperty(textBefore)) {
            return this.provideAttachedPropertyCompletions(textBefore, document, position);
        } else if (this.isCompletingClosingTag(textBefore)) {
            return this.provideClosingTagCompletions(textBefore, document, position);
        }

        return [];
    }

    /**
     * Resolve completion item details
     */
    public resolveCompletionItem(
        item: vscode.CompletionItem,
        token: vscode.CancellationToken
    ): vscode.CompletionItem | Thenable<vscode.CompletionItem> {
        // Add additional documentation if available
        if (item.documentation === undefined && item.detail) {
            item.documentation = new vscode.MarkdownString(item.detail);
        }
        return item;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CONTEXT DETECTION
    // ─────────────────────────────────────────────────────────────────────────

    private isInsideBinding(textBefore: string): boolean {
        // Check if cursor is inside {Binding ...}
        const lastOpen = textBefore.lastIndexOf('{');
        const lastClose = textBefore.lastIndexOf('}');
        const lastQuote = textBefore.lastIndexOf('"');
        
        return lastOpen > lastClose && lastOpen > lastQuote;
    }

    private isInsideResource(textBefore: string): boolean {
        return textBefore.includes('{StaticResource') || 
               textBefore.includes('{DynamicResource') ||
               textBefore.includes('{x:Static');
    }

    private isCompletingElement(textBefore: string): boolean {
        // After '<', potentially starting a new element
        const lastOpen = textBefore.lastIndexOf('<');
        const lastClose = textBefore.lastIndexOf('>');
        const afterWhitespace = textBefore.match(/\<\s*$/);
        
        return lastOpen > lastClose && (afterWhitespace !== null || lastOpen === textBefore.length - 1);
    }

    private isCompletingAttribute(textBefore: string, position: vscode.Position, document: vscode.TextDocument): boolean {
        // Check if we're inside an element's attribute list
        const line = document.lineAt(position.line).text;
        const openTagMatch = line.match(/<(\w+:?\w+)(?:\s+[^=]*)?$/);
        
        if (!openTagMatch) return false;
        
        // Check if cursor is not past the first '=' (we're completing attribute name, not value)
        const afterOpenTag = line.substring(line.indexOf(openTagMatch[0]) + openTagMatch[0].length, position.character);
        return !afterOpenTag.includes('=');
    }

    private isCompletingAttachedProperty(textBefore: string): boolean {
        // After element name followed by property like "Grid."
        return /\w+\.\w*$/.test(textBefore.trim());
    }

    private isCompletingClosingTag(textBefore: string): boolean {
        // After '</'
        return textBefore.trim().startsWith('</');
    }

    // ─────────────────────────────────────────────────────────────────────────
    // COMPLETION PROVIDERS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Provide element name completions (e.g., <StackLayout, <Grid, etc.)
     */
    private provideElementCompletions(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        // Add MAUI built-in controls
        for (const control of ALL_CONTROLS) {
            const item = new vscode.CompletionItem(control.name, vscode.CompletionItemKind.Class);
            item.detail = `${control.namespace} (${control.category})`;
            item.documentation = new vscode.MarkdownString(control.description);
            
            // Add snippet for quick completion
            if (control.contentProperty) {
                item.insertText = new vscode.SnippetString(
                    `${control.name}\n    `,
                );
                item.insertText.appendPlaceholder('content');
                item.insertText.appendText(`\n</${control.name}>`);
            }
            
            items.push(item);
        }

        // Add Floworks custom controls with special styling
        for (const control of FLOWORKS_CUSTOM_CONTROLS) {
            const item = new vscode.CompletionItem(control.name, vscode.CompletionItemKind.Class);
            item.detail = `🔷 ${control.namespace}`;
            item.documentation = new vscode.MarkdownString(`**Floworks Custom Control**\n\n${control.description}`);
            item.sortText = '0'; // Sort first
            items.push(item);
        }

        return items;
    }

    /**
     * Provide attribute completions for elements
     */
    private provideAttributeCompletions(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const line = document.lineAt(position.line).text;

        // Find current element name
        const elementMatch = line.match(/<(\w+:?\w+)/);
        if (!elementMatch) return items;

        const elementName = elementMatch[1].split(':').pop()!; // Remove namespace prefix
        const properties = getPropertySuggestions(elementName);

        // Common attributes for all elements
        const commonAttrs = [
            { name: 'x:Name', type: 'string', desc: 'Element name for code-behind reference' },
            { name: 'x:Class', type: 'string', desc: 'Code-behind class name' },
            { name: 'x:DataType', type: 'type', desc: 'ViewModel type for bindings' },
            { name: 'Style', type: 'style', desc: 'Style resource' },
            { name: 'ClassId', type: 'string', desc: 'CSS-like class identifier' },
            { name: 'IsVisible', type: 'bool', desc: 'Element visibility' },
            { name: 'IsEnabled', type: 'bool', desc: 'Element enabled state' },
            { name: 'Opacity', type: 'double', desc: 'Element opacity (0-1)' },
            { name: 'BackgroundColor', type: 'color', desc: 'Background color' },
        ];

        // Add common attributes
        for (const attr of commonAttrs) {
            const item = new vscode.CompletionItem(attr.name, vscode.CompletionItemKind.Property);
            item.detail = attr.type;
            item.documentation = attr.desc;
            item.insertText = attr.name + '="';
            item.additionalTextEdits = [
                vscode.TextEdit.insert(position, '"')
            ];
            items.push(item);
        }

        // Add element-specific attributes
        for (const prop of properties) {
            const item = new vscode.CompletionItem(prop.name, vscode.CompletionItemKind.Property);
            item.detail = prop.type;
            item.documentation = prop.description || `${prop.name} property`;
            item.insertText = new vscode.SnippetString(`${prop.name}="\${1:${prop.defaultValue || ''}}"`);
            item.additionalTextEdits = [
                vscode.TextEdit.insert(position, '"')
            ];
            items.push(item);
        }

        // Add attached property prefixes
        const attachedPrefixes = ['Grid.', 'FlexLayout.', 'AbsoluteLayout.'];
        for (const prefix of attachedPrefixes) {
            const item = new vscode.CompletionItem(prefix, vscode.CompletionItemKind.Property);
            item.detail = 'Attached Property';
            item.documentation = 'Attached property prefix';
            items.push(item);
        }

        return items;
    }

    /**
     * Provide binding expression completions
     */
    private provideBindingCompletions(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const line = document.lineAt(position.line).text.substring(0, position.character);
        const xamlContent = document.getText();

        // Get ViewModel binding context
        const context = BindingResolver.getBindingContext(xamlContent, document.fileName);
        
        if (context.viewModelPath) {
            // Provide ViewModel property completions
            const suggestions = BindingResolver.getBindingSuggestions(
                context.viewModelPath,
                context.xDataType || undefined
            );

            for (const suggestion of suggestions) {
                const item = new vscode.CompletionItem(
                    suggestion.label,
                    suggestion.kind === 'command' ? vscode.CompletionItemKind.Method : vscode.CompletionItemKind.Property
                );
                item.detail = `[${suggestion.category}] ${suggestion.detail}`;
                item.documentation = suggestion.documentation;
                item.insertText = new vscode.SnippetString(
                    `${suggestion.label}`
                );
                item.range = this.getBindingRange(document, position);
                items.push(item);
            }
        }

        // Add binding mode completions
        const modes = ['Mode=OneWay', 'Mode=TwoWay', 'Mode=OneTime', 'Mode=OneWayToSource'];
        for (const mode of modes) {
            const item = new vscode.CompletionItem(mode, vscode.CompletionItemKind.Enum);
            item.detail = 'Binding Mode';
            item.insertText = mode;
            item.range = this.getBindingRange(document, position);
            items.push(item);
        }

        // Add binding modifiers
        const modifiers = ['Converter=', 'FallbackValue=', 'StringFormat=', 'Source='];
        for (const mod of modifiers) {
            const item = new vscode.CompletionItem(mod, vscode.CompletionItemKind.Property);
            item.detail = 'Binding Modifier';
            item.insertText = mod;
            item.range = this.getBindingRange(document, position);
            items.push(item);
        }

        return items;
    }

    /**
     * Provide attached property completions
     */
    private provideAttachedPropertyCompletions(
        textBefore: string,
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const match = textBefore.trim().match(/(\w+)\.(\w*)$/);
        
        if (!match) return items;

        const [, owner, partial] = match;
        const attachedProps = getAttachedPropertySuggestions(owner);

        for (const prop of attachedProps) {
            if (!partial || prop.name.toLowerCase().startsWith(partial.toLowerCase())) {
                const item = new vscode.CompletionItem(
                    `${owner}.${prop.name}`,
                    vscode.CompletionItemKind.Property
                );
                item.detail = prop.propertyType;
                item.insertText = new vscode.SnippetString(
                    `${owner}.${prop.name}="\${1:${prop.defaultValue || '0'}}"`
                );
                item.additionalTextEdits = [
                    vscode.TextEdit.insert(position, '"')
                ];
                items.push(item);
            }
        }

        return items;
    }

    /**
     * Provide resource key completions
     */
    private provideResourceCompletions(
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const textBefore = document.lineAt(position.line).text.substring(0, position.character);

        // Determine resource type
        const isStatic = textBefore.includes('StaticResource');
        const isDynamic = textBefore.includes('DynamicResource');
        const isXStatic = textBefore.includes('x:Static');

        // Add common MAUI resources
        const commonResources = [
            'PrimaryAction', 'PrimaryText', 'PrimaryBackground',
            'TextPrimary', 'TextSecondary', 'TextTertiary',
            'BorderBrush', 'BackgroundPrimary', 'BackgroundSecondary',
            'SuccessColor', 'WarningColor', 'ErrorColor', 'InfoColor',
            'FontSizeSmall', 'FontSizeNormal', 'FontSizeLarge', 'FontSizeTitle',
            'SpacingSmall', 'SpacingNormal', 'SpacingLarge',
        ];

        for (const res of commonResources) {
            const item = new vscode.CompletionItem(res, vscode.CompletionItemKind.Variable);
            item.detail = isXStatic ? 'Static Member' : 'Resource Key';
            item.insertText = res;
            items.push(item);
        }

        return items;
    }

    /**
     * Provide closing tag completions
     */
    private provideClosingTagCompletions(
        textBefore: string,
        document: vscode.TextDocument,
        position: vscode.Position
    ): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];
        const match = textBefore.match(/<\/(\w*)$/);

        if (!match) return items;

        const [, partial] = match;

        // Find matching open tags
        const text = document.getText();
        const openTags = this.findOpenTags(text);

        for (const tag of openTags) {
            if (!partial || tag.toLowerCase().includes(partial.toLowerCase())) {
                const item = new vscode.CompletionItem(`</${tag}>`, vscode.CompletionItemKind.Property);
                item.detail = 'Closing Tag';
                item.insertText = `${tag}>`;
                items.push(item);
            }
        }

        return items;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPER METHODS
    // ─────────────────────────────────────────────────────────────────────────

    private getBindingRange(document: vscode.TextDocument, position: vscode.Position): vscode.Range {
        const line = document.lineAt(position.line);
        const text = line.text;
        
        // Find the start of binding expression
        let startIndex = text.lastIndexOf('{', position.character);
        if (startIndex === -1) startIndex = 0;
        
        return new vscode.Range(position.line, startIndex, position.line, position.character);
    }

    private findOpenTags(text: string): string[] {
        const tags = new Set<string>();
        const regex = /<(\w+:?\w+)(?:\s|>)/g;
        let match;

        while ((match = regex.exec(text)) !== null) {
            tags.add(match[1].split(':').pop()!);
        }

        return Array.from(tags);
    }

    /**
     * Get element suggestions with filtering
     */
    public getFilteredElementSuggestions(filter: string): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        for (const control of ALL_CONTROLS) {
            if (control.name.toLowerCase().includes(filter.toLowerCase())) {
                const item = new vscode.CompletionItem(control.name, vscode.CompletionItemKind.Class);
                item.detail = control.namespace;
                item.documentation = control.description;
                items.push(item);
            }
        }

        return items;
    }
}

/**
 * Create completion trigger characters provider
 */
export function createCompletionProvider(): MauiCompletionProvider {
    return new MauiCompletionProvider();
}
