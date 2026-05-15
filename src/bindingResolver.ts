/**
 * Binding Resolver for MAUI XAML
 * Provides IntelliSense-like binding resolution and suggestions
 */

import * as path from 'path';
import * as fs from 'fs';
import { CSharpParser, CSharpProperty, ViewModelInfo } from './csharpParser';

/**
 * Represents a parsed binding expression from XAML
 */
export interface ParsedBinding {
    path: string;              // e.g., "CustomerName" or "Order.Customer.Name"
    mode?: string;             // OneWay, TwoWay, OneTime, OneWayToSource
    converter?: string;        // Converter resource key
    fallbackValue?: string;    // Fallback value
    stringFormat?: string;     // String format
    source?: string;           // Source (e.g., "{x:Static}", relative source)
    lineNumber?: number;       // Line where binding appears
}

/**
 * Represents a binding context
 */
export interface BindingContext {
    viewModelPath: string | null;
    viewModelInfo: ViewModelInfo | null;
    xDataType: string | null;  // e.g., "viewmodels:OrdersViewModel"
    dataType: string;          // e.g., "SalesOrderDto"
}

/**
 * Binding suggestion for auto-completion
 */
export interface BindingSuggestion {
    label: string;             // Property name
    insertText: string;        // Text to insert
    kind: 'property' | 'command' | 'event';
    detail: string;            // Type information
    documentation?: string;    // Description
    category: 'Base ViewModel' | 'ViewModel' | 'DTO' | 'Command';
}

/**
 * XAML Element with its bindings
 */
export interface XamlElementBindings {
    elementName: string;
    xName?: string;
    bindings: Array<{
        attribute: string;
        binding: ParsedBinding;
    }>;
}

/**
 * Main Binding Resolver class
 */
export class BindingResolver {
    
    // Regex patterns for binding expressions
    private static readonly BINDING_PATTERN = /\{Binding\s+([^}]+)\}/g;
    private static readonly STATIC_RESOURCE_PATTERN = /\{StaticResource\s+([^}]+)\}/g;
    private static readonly DYNAMIC_RESOURCE_PATTERN = /\{DynamicResource\s+([^}]+)\}/g;
    private static readonly XAML_NS_PATTERN = /xmlns(?::(\w+))?\s*=\s*["']([^"']+)["']/g;
    private static readonly DATA_TYPE_PATTERN = /x:DataType\s*=\s*["']([^"']+)["']/g;
    private static readonly X_NAME_PATTERN = /x:Name\s*=\s*["']([^"']+)["']/g;

    // Standard MAUI/MAUI binding modes
    public static readonly BINDING_MODES = ['OneWay', 'TwoWay', 'OneTime', 'OneWayToSource'];

    // ─────────────────────────────────────────────────────────────────────────
    // MAIN BINDING RESOLUTION
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Resolve bindings in a XAML document
     */
    public static resolveDocumentBindings(
        xamlContent: string,
        xamlFilePath: string
    ): XamlElementBindings[] {
        const results: XamlElementBindings[] = [];
        const lines = xamlContent.split('\n');

        // Extract namespace declarations
        const namespaces = this.extractNamespaces(xamlContent);

        // Extract x:DataType
        const xDataType = this.extractDataType(xamlContent);

        // Extract all x:Name elements
        const namedElements = this.extractNamedElements(xamlContent);

        // Parse each line for bindings
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineBindings = this.parseLineBindings(line, i + 1);

            if (lineBindings.length > 0) {
                // Find which element this line belongs to
                const elementMatch = line.match(/<(\w+:?\w+)/);
                const elementName = elementMatch ? elementMatch[1] : 'Unknown';
                const xName = this.getElementXName(namedElements, i + 1);

                results.push({
                    elementName,
                    xName,
                    bindings: lineBindings.map(binding => ({
                        attribute: this.extractAttributeName(line, binding),
                        binding
                    }))
                });
            }
        }

        return results;
    }

    /**
     * Get all binding suggestions for a ViewModel
     */
    public static getBindingSuggestions(
        viewModelPath: string,
        xDataType?: string
    ): BindingSuggestion[] {
        const suggestions: BindingSuggestion[] = [];
        const viewModelInfo = CSharpParser.parseViewModel(viewModelPath, xDataType);

        if (!viewModelInfo) {
            return suggestions;
        }

        // 1. Add base ViewModel properties (grouped separately)
        for (const prop of viewModelInfo.baseProperties) {
            suggestions.push({
                label: prop.name,
                insertText: `{Binding ${prop.name}}`,
                kind: prop.isCommand ? 'command' : 'property',
                detail: prop.type,
                documentation: prop.description,
                category: 'Base ViewModel'
            });
        }

        // 2. Add ViewModel-specific properties
        for (const prop of viewModelInfo.properties) {
            if (!viewModelInfo.baseProperties.some(p => p.name === prop.name)) {
                suggestions.push({
                    label: prop.name,
                    insertText: `{Binding ${prop.name}}`,
                    kind: prop.isCommand ? 'command' : 'property',
                    detail: prop.type,
                    documentation: prop.description,
                    category: 'ViewModel'
                });
            }
        }

        // 3. Add commands with Command suffix
        for (const cmd of viewModelInfo.commands) {
            suggestions.push({
                label: cmd.name,
                insertText: `{Binding ${cmd.name}}`,
                kind: 'command',
                detail: cmd.type,
                documentation: `Command: ${cmd.methodName || cmd.name}`,
                category: 'Command'
            });
        }

        // 4. Add DTO properties (from x:DataType)
        if (xDataType) {
            const dtoProps = this.getDtoProperties(viewModelPath, xDataType);
            for (const prop of dtoProps) {
                if (!suggestions.some(s => s.label === prop.name)) {
                    suggestions.push({
                        label: prop.name,
                        insertText: `{Binding ${prop.name}}`,
                        kind: 'property',
                        detail: prop.type,
                        documentation: prop.description,
                        category: 'DTO'
                    });
                }
            }
        }

        return suggestions;
    }

    /**
     * Get binding context from XAML document
     */
    public static getBindingContext(
        xamlContent: string,
        xamlFilePath: string
    ): BindingContext {
        const xDataType = this.extractDataType(xamlContent);
        const viewModelPath = CSharpParser.resolveViewModelPath(xamlFilePath, xDataType || undefined);
        
        let viewModelInfo: ViewModelInfo | null = null;
        let dataType = 'object';

        if (viewModelPath) {
            viewModelInfo = CSharpParser.parseViewModel(viewModelPath, xDataType || undefined);
            if (viewModelInfo) {
                dataType = viewModelInfo.dataType;
            }
        }

        return {
            viewModelPath,
            viewModelInfo,
            xDataType,
            dataType
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // BINDING EXPRESSION PARSING
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Parse a single binding expression
     */
    public static parseBindingExpression(bindingExpr: string, lineNumber?: number): ParsedBinding {
        const binding: ParsedBinding = {
            path: '',
            lineNumber
        };

        // Split by comma for multiple properties
        const parts = bindingExpr.split(',').map(p => p.trim());

        for (const part of parts) {
            const [key, ...valueParts] = part.split('=').map(p => p.trim());
            const value = valueParts.join('=');

            switch (key.toLowerCase()) {
                case '':
                    // First part without key=value is the path
                    binding.path = part;
                    break;
                case 'path':
                    binding.path = value;
                    break;
                case 'mode':
                    binding.mode = value;
                    break;
                case 'converter':
                    binding.converter = value;
                    break;
                case 'fallbackvalue':
                case 'fallback':
                    binding.fallbackValue = value;
                    break;
                case 'stringformat':
                case 'string.format':
                    binding.stringFormat = value;
                    break;
                case 'source':
                    binding.source = value;
                    break;
            }
        }

        return binding;
    }

    /**
     * Parse all bindings in a single line
     */
    public static parseLineBindings(line: string, lineNumber: number): ParsedBinding[] {
        const bindings: ParsedBinding[] = [];
        
        // Match {Binding ...} patterns
        let match;
        const regex = new RegExp(this.BINDING_PATTERN.source, 'g');
        
        while ((match = regex.exec(line)) !== null) {
            try {
                const parsed = this.parseBindingExpression(match[1], lineNumber);
                bindings.push(parsed);
            } catch (e) {
                // Invalid binding expression, skip
            }
        }

        return bindings;
    }

    /**
     * Validate a binding path against known properties
     */
    public static validateBinding(
        binding: ParsedBinding,
        availableProperties: CSharpProperty[]
    ): { valid: boolean; message?: string; suggestedProperty?: string } {
        if (!binding.path) {
            return { valid: false, message: 'Empty binding path' };
        }

        // Handle nested paths (e.g., "Order.Customer.Name")
        const pathParts = binding.path.split('.');
        const firstPart = pathParts[0];

        // Check if first part exists in properties
        const matchingProperty = availableProperties.find(
            p => p.name.toLowerCase() === firstPart.toLowerCase()
        );

        if (!matchingProperty) {
            // Suggest similar property names
            const suggestions = this.suggestSimilarProperty(firstPart, availableProperties);
            return {
                valid: false,
                message: `Unknown property: ${firstPart}`,
                suggestedProperty: suggestions[0]
            };
        }

        return { valid: true };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // NAMESPACE AND TYPE RESOLUTION
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Extract namespace declarations from XAML
     */
    public static extractNamespaces(xamlContent: string): Map<string, string> {
        const namespaces = new Map<string, string>();
        
        let match;
        const regex = new RegExp(this.XAML_NS_PATTERN.source, 'g');
        
        while ((match = regex.exec(xamlContent)) !== null) {
            const prefix = match[1] || '';  // Empty prefix for default namespace
            const uri = match[2];
            namespaces.set(prefix, uri);
        }

        return namespaces;
    }

    /**
     * Extract x:DataType from XAML
     */
    public static extractDataType(xamlContent: string): string | null {
        const match = xamlContent.match(this.DATA_TYPE_PATTERN);
        return match ? match[1] : null;
    }

    /**
     * Extract all named elements from XAML
     */
    public static extractNamedElements(xamlContent: string): Map<string, number[]> {
        const namedElements = new Map<string, number[]>();
        const lines = xamlContent.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const match = lines[i].match(this.X_NAME_PATTERN);
            if (match) {
                const name = match[1];
                if (!namedElements.has(name)) {
                    namedElements.set(name, []);
                }
                namedElements.get(name)!.push(i + 1);
            }
        }

        return namedElements;
    }

    /**
     * Resolve namespace prefix to full type name
     */
    public static resolveNamespace(
        prefix: string,
        namespaces: Map<string, string>,
        xamlContent: string,
        projectRoot: string
    ): string | null {
        const uri = namespaces.get(prefix);
        if (!uri) return null;

        // Handle clr-namespace
        if (uri.startsWith('clr-namespace:')) {
            const match = uri.match(/clr-namespace:([^;]+)(?:;assembly=([^;]+))?/);
            if (match) {
                return match[1];
            }
        }

        // Handle using: (C# using directive in XAML)
        if (uri.startsWith('using:')) {
            return uri.substring(6);
        }

        return null;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // XAML ELEMENT ANALYSIS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Analyze XAML element and suggest completions
     */
    public static analyzeElement(
        elementName: string,
        attributes: Record<string, string>,
        viewModelInfo: ViewModelInfo | null
    ): {
        suggestedAttributes: Array<{ name: string; type: string; description: string }>;
        suggestedBindings: BindingSuggestion[];
        issues: Array<{ attribute: string; message: string; severity: 'error' | 'warning' }>;
    } {
        // Import schema lazily to avoid circular dependency
        const { getPropertySuggestions, getBindingSuggestions } = require('./mauiSchema');
        
        const suggestedAttributes = getPropertySuggestions(elementName);
        const suggestedBindings = viewModelInfo 
            ? this.getBindingSuggestions(viewModelInfo.filePath, undefined)
            : [];
        
        const issues: Array<{ attribute: string; message: string; severity: 'error' | 'warning' }> = [];

        // Check for common issues
        for (const [attr, value] of Object.entries(attributes)) {
            // Check for binding syntax errors
            if (value.startsWith('{Binding') && !value.endsWith('}')) {
                issues.push({
                    attribute: attr,
                    message: 'Incomplete binding expression',
                    severity: 'error'
                });
            }

            // Check for invalid binding path
            if (value.startsWith('{Binding ')) {
                const binding = this.parseBindingExpression(value.substring(8, value.length - 1));
                if (viewModelInfo) {
                    const validation = this.validateBinding(binding, [
                        ...viewModelInfo.baseProperties,
                        ...viewModelInfo.properties
                    ]);
                    if (!validation.valid) {
                        issues.push({
                            attribute: attr,
                            message: validation.message || 'Invalid binding',
                            severity: 'warning'
                        });
                    }
                }
            }
        }

        return { suggestedAttributes, suggestedBindings, issues };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // HELPER METHODS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Get x:Name for an element at a specific line
     */
    private static getElementXName(namedElements: Map<string, number[]>, lineNumber: number): string | undefined {
        for (const [name, lines] of namedElements.entries()) {
            if (lines.includes(lineNumber)) {
                return name;
            }
        }
        return undefined;
    }

    /**
     * Extract attribute name from line
     */
    private static extractAttributeName(line: string, binding: ParsedBinding): string {
        // Find which attribute contains this binding
        const attributes = line.match(/(\w+)\s*=\s*\{[^}]+\}/g);
        if (!attributes) return 'unknown';

        for (const attr of attributes) {
            if (attr.includes(`{Binding ${binding.path}`) || attr.includes(`{Binding${binding.path}`)) {
                return attr.split('=')[0].trim();
            }
        }

        return 'unknown';
    }

    /**
     * Get DTO properties for binding suggestions
     */
    private static getDtoProperties(viewModelPath: string, xDataType: string): CSharpProperty[] {
        const parts = xDataType.split(':');
        const dtoClassName = parts.length > 1 ? parts[1] : parts[0];
        const cleanDtoName = dtoClassName.split('<')[0];

        // Try common DTO locations
        const possiblePaths = [
            path.join(path.dirname(viewModelPath), '..', 'Models', 'Api', `${cleanDtoName}.cs`),
            path.join(path.dirname(viewModelPath), '..', 'Models', 'Dto', `${cleanDtoName}.cs`),
            path.join(path.dirname(viewModelPath), '..', '..', 'Dto', 'ApiDtos', `${cleanDtoName}.cs`),
        ];

        for (const dtoPath of possiblePaths) {
            if (fs.existsSync(dtoPath)) {
                return CSharpParser.parseDto(dtoPath);
            }
        }

        return [];
    }

    /**
     * Suggest similar property names
     */
    private static suggestSimilarProperty(name: string, properties: CSharpProperty[]): string[] {
        const lowerName = name.toLowerCase();
        
        return properties
            .filter(p => {
                const lowerProp = p.name.toLowerCase();
                // Check for Levenshtein distance <= 2 or common prefix
                return this.levenshteinDistance(lowerName, lowerProp) <= 2 ||
                       lowerName.startsWith(lowerProp.substring(0, 2));
            })
            .map(p => p.name)
            .slice(0, 5);
    }

    /**
     * Calculate Levenshtein distance between two strings
     */
    private static levenshteinDistance(a: string, b: string): number {
        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        const matrix: number[][] = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }

        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // CODE GENERATION
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Generate binding expression from property
     */
    public static generateBinding(property: { name: string }, mode?: string): string {
        let binding = `{Binding ${property.name}`;
        
        if (mode && mode !== 'OneWay') {
            binding += `, Mode=${mode}`;
        }
        
        binding += '}';
        return binding;
    }

    /**
     * Generate complete property element for XAML
     */
    public static generatePropertyElement(
        controlName: string,
        propertyName: string,
        binding?: { name: string },
        value?: string
    ): string {
        if (binding) {
            return `${controlName}.${propertyName}="${this.generateBinding(binding)}"`;
        } else if (value !== undefined) {
            return `${controlName}.${propertyName}="${value}"`;
        }
        return '';
    }

    /**
     * Generate template for new ERP page
     */
    public static generateErpPageTemplate(
        pageName: string,
        viewModelName: string,
        dtoName: string,
        columns: Array<{ key: string; header: string; type: string }>,
        filters: Array<{ key: string; label: string; type: string }>
    ): string {
        const snakeToPascal = (s: string) => s.split('_').map(p => 
            p.charAt(0).toUpperCase() + p.slice(1)
        ).join('');

        return `<?xml version="1.0" encoding="utf-8" ?>
<ContentPage xmlns="http://schemas.microsoft.com/dotnet/2021/maui"
             xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml"
             xmlns:controls="clr-namespace:Floworks.MAUI.Views.Controls"
             xmlns:viewmodels="clr-namespace:Floworks.MAUI.ViewModels.Modules"
             xmlns:local="clr-namespace:Floworks.MAUI.Views.Modules"
             x:Class="Floworks.MAUI.Views.Modules.${pageName}"
             x:DataType="viewmodels:${viewModelName}"
             Title="${snakeToPascal(pageName.replace(/([A-Z])/g, ' $1').trim())}">

  <ContentPage.Content>
    <Grid RowSpacing="0">
      <Grid.RowDefinitions>
        <!-- Row 0: Sub-tab bar -->
        <RowDefinition Height="44" />
        <!-- Row 1: Filter bar -->
        <RowDefinition Height="Auto" />
        <!-- Row 2: Content -->
        <RowDefinition Height="*" />
      </Grid.RowDefinitions>

      <!-- ── Sub-tab bar ─────────────────────────────────────────────────── -->
      <Grid Grid.Row="0" BackgroundColor="#1B1F2A" ColumnSpacing="0">
        <Grid.ColumnDefinitions>
          <ColumnDefinition Width="Auto" />
          <ColumnDefinition Width="*" />
        </Grid.ColumnDefinitions>

        <Grid Grid.Column="0">
          <Button Text="📋  Seznam"
                  FontSize="13"
                  Padding="20,0"
                  BackgroundColor="{Binding IsListVisible, Converter={StaticResource BoolToTabColorConverter}}"
                  TextColor="{Binding IsListVisible, Converter={StaticResource BoolToTabTextColorConverter}}"
                  Command="{Binding GoToTabCommand}"
                  CommandParameter="0"
                  CornerRadius="0"
                  HeightRequest="44" />
          <BoxView BackgroundColor="#C54A1B"
                   HeightRequest="3"
                   VerticalOptions="End"
                   IsVisible="{Binding IsListVisible}" />
        </Grid>

        <BoxView Grid.Column="1" BackgroundColor="Transparent" />
        <BoxView Grid.Row="0" Grid.ColumnSpan="2"
                 BackgroundColor="#2F3642"
                 HeightRequest="1"
                 VerticalOptions="End" />
      </Grid>

      <!-- ── Filter bar ─────────────────────────────────────────────────── -->
      <controls:StandardFilterBar Grid.Row="1"
          IsVisible="{Binding IsListVisible}"
          FilterDefinitions="{Binding FilterDefinitions}"
          ApplyFiltersCommand="{Binding ApplyFiltersCommand}"
          ClearFiltersCommand="{Binding ClearFiltersCommand}"
          AvailableViews="{Binding AvailableViews}"
          SelectedView="{Binding SelectedViewKey, Mode=TwoWay}"
          IsLoading="{Binding IsLoading}" />

      <!-- ── Data table ─────────────────────────────────────────────────── -->
      <controls:DataTableView Grid.Row="2"
          IsVisible="{Binding IsListVisible}"
          Columns="{Binding TableColumns}"
          ItemsSource="{Binding FilteredItems}"
          SelectedItem="{Binding SelectedItem, Mode=TwoWay}"
          SortCommand="{Binding SortCommand}"
          RowTappedCommand="{Binding EditCommand}"
          CurrentSortColumn="{Binding SortColumn}"
          CurrentSortAscending="{Binding SortAscending}"
          EmptyStateMessage="Ni podatkov za prikaz."
          IsLoading="{Binding IsLoading}" />

    </Grid>
  </ContentPage.Content>
</ContentPage>`;
    }

    /**
     * Generate ViewModel template
     */
    public static generateViewModelTemplate(
        viewModelName: string,
        dtoName: string,
        moduleKey: string,
        columns: Array<{ key: string; header: string; type: string }>,
        filters: Array<{ key: string; label: string; type: string }>
    ): string {
        const snakeToPascal = (s: string) => s.split('_').map(p => 
            p.charAt(0).toUpperCase() + p.slice(1)
        ).join('');

        const pascalToSnake = (s: string) => s.replace(/([A-Z])/g, '_$1').toLowerCase();

        const columnDefs = columns.map(c => 
            `            TableColumns.Add(new TableColumnDefinition { Key = "${pascalToSnake(c.key).replace(/^_/, '')}", Header = "${c.header}", DataType = ColumnDataType.${c.type === 'string' ? 'Text' : c.type}, Width = 130 });`
        ).join('\n');

        const filterDefs = filters.map(f =>
            `            FilterDefinitions.Add(new FilterDefinition { Key = "${pascalToSnake(f.key).replace(/^_/, '')}", Label = "${f.label}", Type = FilterType.${f.type === 'text' ? 'TextSearch' : f.type} });`
        ).join('\n');

        return `using System.Collections.ObjectModel;
using System.Windows.Input;
using Floworks.MAUI.Models;
using Floworks.MAUI.Models.UI;
using Floworks.MAUI.Services;
using Floworks.Dto.ApiDtos;
using Floworks.MAUI.ViewModels.Modules;

namespace Floworks.MAUI.ViewModels.Modules.${snakeToPascal(moduleKey)};

public class ${viewModelName} : StandardTableViewModel<${dtoName}>
{
    private readonly ISomeApiClient _api;
    private List<${dtoName}> _allItems = new();

    protected override string? ModuleKey => "${moduleKey}";
    protected override string? ViewKeyPrefix => "${moduleKey}.${pascalToSnake(viewModelName).replace(/^_/, '')}";

    public ${viewModelName}(IDatabaseService databaseService, ISomeApiClient api, IPermissionService? permissionService = null)
        : base(databaseService, permissionService: permissionService)
    {
        _api = api;
        EmptyMessage = "Ni podatkov za prikaz.";
        InitializeTableDefinitions();
    }

    protected override void DefineFilters()
    {
${filterDefs}
    }

    protected override void DefineColumns()
    {
${columnDefs}
    }

    protected override void DefineActions()
    {
        ToolbarActions.Add(new ToolbarAction
        {
            Id = "add",
            Text = "Novo",
            Icon = "➕",
            Tooltip = "Dodaj novo",
            Command = AddCommand,
            Group = "primary",
            SortOrder = 1,
            BackgroundColor = Color.FromArgb("#C54A1B")
        });
    }

    protected override async Task LoadDataAsync()
    {
        try
        {
            IsLoading = true;

            var list = await Task.Run(async () =>
            {
                var result = await _api.Get${snakeToPascal(dtoName).replace(/Dto$/, 's')}Async().ConfigureAwait(false);
                return result?.ToList() ?? new List<${dtoName}>();
            }).ConfigureAwait(false);

            _allItems = list;
            var filtered = _allItems.AsEnumerable();

            // Apply filters
            var searchText = GetFilterString("search");
            if (!string.IsNullOrWhiteSpace(searchText))
            {
                // Add search filter logic
            }

            var sorted = filtered.ToList();
            if (!string.IsNullOrEmpty(SortColumn))
            {
                sorted = ApplySort(sorted).ToList();
            }

            MainThread.BeginInvokeOnMainThread(() =>
            {
                FilteredItems.Clear();
                foreach (var item in sorted) FilteredItems.Add(item);
                IsLoading = false;
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[${viewModelName}] LoadDataAsync error: {ex}");
            MainThread.BeginInvokeOnMainThread(() => IsLoading = false);
        }
    }

    protected override async Task DeleteItemAsync(${dtoName} item)
    {
        try
        {
            await _api.Delete${snakeToPascal(dtoName).replace(/Dto$/, '')}Async(item.${dtoName.replace('Dto', 'Id')});
        }
        catch (Exception ex)
        {
            await Shell.Current.DisplayAlert("Napaka", $"Brisanje ni uspelo: {ex.Message}", "OK");
        }
    }
}`;
    }
}
