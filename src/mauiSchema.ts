/**
 * MAUI Control Schema - Complete schema for MAUI and custom Floworks controls
 * This provides IntelliSense-like suggestions for XAML element completion
 */

/**
 * Schema property definition for auto-completion
 */
export interface SchemaProperty {
    name: string;
    type: 'string' | 'number' | 'boolean' | 'color' | 'enum' | 'select' | 'command' | 'view' | 'ienumerable' | 'object' | 'datatemplate' | 'image';
    values?: string[];           // For enum/select types
    defaultValue?: string;
    binding?: boolean;            // Can be used in bindings
    twoWay?: boolean;            // Supports TwoWay binding
    description?: string;
}

export interface ControlSchema {
    name: string;
    namespace: string;
    description: string;
    category: 'Layout' | 'Controls' | 'Collections' | 'Navigation' | 'Visual' | 'Shapes' | 'Pages';
    properties: SchemaProperty[];
    contentProperty?: string;  // e.g., "Children" for StackLayout
    attachedProperties?: AttachedProperty[];
    defaultContent?: string;   // Default child template
}

export interface AttachedProperty {
    name: string;
    ownerType: string;         // e.g., "Grid"
    propertyType: string;
    defaultValue?: string;
}

// ============================================================================
// MAUI Built-in Controls
// ============================================================================

export const MAUI_BUILTIN_CONTROLS: ControlSchema[] = [
    // ─────────────────────────────────────────────────────────────────────────
    // LAYOUT CONTROLS
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: 'StackLayout',
        namespace: 'Microsoft.Maui.Controls',
        description: 'Positions child elements in a single line which can be oriented vertically or horizontally.',
        category: 'Layout',
        contentProperty: 'Children',
        properties: [
            { name: 'Orientation', type: 'enum', values: ['Vertical', 'Horizontal'], defaultValue: 'Vertical' },
            { name: 'Spacing', type: 'number', defaultValue: '6' },
            { name: 'Padding', type: 'string', defaultValue: '0' },
            { name: 'HeightRequest', type: 'number' },
            { name: 'WidthRequest', type: 'number' },
            { name: 'BackgroundColor', type: 'color' },
        ]
    },
    {
        name: 'Grid',
        namespace: 'Microsoft.Maui.Controls',
        description: 'Defines a grid layout with rows and columns.',
        category: 'Layout',
        contentProperty: 'Children',
        attachedProperties: [
            { name: 'Row', ownerType: 'Grid', propertyType: 'int', defaultValue: '0' },
            { name: 'Column', ownerType: 'Grid', propertyType: 'int', defaultValue: '0' },
            { name: 'RowSpan', ownerType: 'Grid', propertyType: 'int', defaultValue: '1' },
            { name: 'ColumnSpan', ownerType: 'Grid', propertyType: 'int', defaultValue: '1' },
        ],
        properties: [
            { name: 'RowDefinitions', type: 'string' },
            { name: 'ColumnDefinitions', type: 'string' },
            { name: 'RowSpacing', type: 'number', defaultValue: '6' },
            { name: 'ColumnSpacing', type: 'number', defaultValue: '6' },
            { name: 'BackgroundColor', type: 'color' },
        ]
    },
    {
        name: 'VerticalStackLayout',
        namespace: 'Microsoft.Maui.Controls',
        description: 'Stacks child elements vertically.',
        category: 'Layout',
        contentProperty: 'Children',
        properties: [
            { name: 'Spacing', type: 'number', defaultValue: '6' },
            { name: 'Padding', type: 'string', defaultValue: '0' },
        ]
    },
    {
        name: 'HorizontalStackLayout',
        namespace: 'Microsoft.Maui.Controls',
        description: 'Stacks child elements horizontally.',
        category: 'Layout',
        contentProperty: 'Children',
        properties: [
            { name: 'Spacing', type: 'number', defaultValue: '6' },
            { name: 'Padding', type: 'string', defaultValue: '0' },
        ]
    },
    {
        name: 'FlexLayout',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A layout that can arrange its children horizontally and vertically or wrap them.',
        category: 'Layout',
        contentProperty: 'Children',
        attachedProperties: [
            { name: 'Grow', ownerType: 'FlexLayout', propertyType: 'double', defaultValue: '0' },
            { name: 'Shrink', ownerType: 'FlexLayout', propertyType: 'double', defaultValue: '1' },
            { name: 'Basis', ownerType: 'FlexLayout', propertyType: 'GridLength' },
            { name: 'AlignSelf', ownerType: 'FlexLayout', propertyType: 'FlexAlignSelf' },
            { name: 'Order', ownerType: 'FlexLayout', propertyType: 'int', defaultValue: '0' },
        ],
        properties: [
            { name: 'Direction', type: 'enum', values: ['Column', 'ColumnReverse', 'Row', 'RowReverse'], defaultValue: 'Row' },
            { name: 'Wrap', type: 'enum', values: ['NoWrap', 'Wrap', 'Reverse'], defaultValue: 'NoWrap' },
            { name: 'JustifyContent', type: 'enum', values: ['Start', 'Center', 'End', 'SpaceBetween', 'SpaceAround', 'SpaceEvenly'], defaultValue: 'Start' },
            { name: 'AlignItems', type: 'enum', values: ['Start', 'Center', 'End', 'Stretch'], defaultValue: 'Stretch' },
            { name: 'AlignContent', type: 'enum', values: ['Start', 'Center', 'End', 'SpaceBetween', 'SpaceAround', 'SpaceEvenly', 'Stretch'], defaultValue: 'Stretch' },
        ]
    },
    {
        name: 'AbsoluteLayout',
        namespace: 'Microsoft.Maui.Controls',
        description: 'Positions children at absolute coordinates.',
        category: 'Layout',
        contentProperty: 'Children',
        attachedProperties: [
            { name: 'LayoutBounds', ownerType: 'AbsoluteLayout', propertyType: 'Rectangle', defaultValue: '0,0,AutoSize,AutoSize' },
            { name: 'LayoutFlags', ownerType: 'AbsoluteLayout', propertyType: 'AbsoluteLayoutFlags', defaultValue: 'None' },
        ],
        properties: []
    },
    {
        name: 'Border',
        namespace: 'Microsoft.Maui.Controls',
        description: 'Draws a border around its child.',
        category: 'Layout',
        contentProperty: 'Content',
        properties: [
            { name: 'Stroke', type: 'color' },
            { name: 'StrokeThickness', type: 'number', defaultValue: '1' },
            { name: 'StrokeShape', type: 'string' },
            { name: 'Background', type: 'color' },
            { name: 'Padding', type: 'string', defaultValue: '0' },
        ]
    },
    {
        name: 'Frame',
        namespace: 'Microsoft.Maui.Controls',
        description: 'Draws a frame with optional shadow.',
        category: 'Layout',
        contentProperty: 'Content',
        properties: [
            { name: 'BorderColor', type: 'color' },
            { name: 'CornerRadius', type: 'number', defaultValue: '0' },
            { name: 'HasShadow', type: 'boolean', defaultValue: 'False' },
            { name: 'BackgroundColor', type: 'color' },
            { name: 'Padding', type: 'string', defaultValue: '0' },
        ]
    },

    // ─────────────────────────────────────────────────────────────────────────
    // BASIC CONTROLS
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: 'Label',
        namespace: 'Microsoft.Maui.Controls',
        description: 'Displays text.',
        category: 'Controls',
        properties: [
            { name: 'Text', type: 'string', binding: true },
            { name: 'TextColor', type: 'color' },
            { name: 'FontSize', type: 'number' },
            { name: 'FontFamily', type: 'string' },
            { name: 'FontAttributes', type: 'enum', values: ['None', 'Bold', 'Italic', 'Bold,Italic'] },
            { name: 'HorizontalOptions', type: 'enum', values: ['Start', 'Center', 'End', 'Fill', 'StartAndExpand', 'CenterAndExpand', 'EndAndExpand', 'FillAndExpand'] },
            { name: 'VerticalOptions', type: 'enum', values: ['Start', 'Center', 'End', 'Fill', 'StartAndExpand', 'CenterAndExpand', 'EndAndExpand', 'FillAndExpand'] },
            { name: 'HorizontalTextAlignment', type: 'enum', values: ['Start', 'Center', 'End'] },
            { name: 'VerticalTextAlignment', type: 'enum', values: ['Start', 'Center', 'End'] },
            { name: 'LineBreakMode', type: 'enum', values: ['NoWrap', 'WordWrap', 'CharacterWrap', 'HeadTruncation', 'TailTruncation', 'MiddleTruncation'] },
            { name: 'MaxLines', type: 'number' },
            { name: 'TextTransform', type: 'enum', values: ['None', 'Default', 'Lowercase', 'Uppercase'] },
        ]
    },
    {
        name: 'Button',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A button that users can tap.',
        category: 'Controls',
        properties: [
            { name: 'Text', type: 'string', binding: true },
            { name: 'Command', type: 'command', binding: true, twoWay: true },
            { name: 'CommandParameter', type: 'object', binding: true },
            { name: 'BackgroundColor', type: 'color' },
            { name: 'TextColor', type: 'color' },
            { name: 'CornerRadius', type: 'number', defaultValue: '0' },
            { name: 'BorderWidth', type: 'number' },
            { name: 'BorderColor', type: 'color' },
            { name: 'Padding', type: 'string' },
            { name: 'FontSize', type: 'number' },
            { name: 'ImageSource', type: 'image' },
        ]
    },
    {
        name: 'Entry',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A single-line text input.',
        category: 'Controls',
        properties: [
            { name: 'Text', type: 'string', binding: true, twoWay: true },
            { name: 'Placeholder', type: 'string' },
            { name: 'PlaceholderColor', type: 'color' },
            { name: 'TextColor', type: 'color' },
            { name: 'Keyboard', type: 'enum', values: ['Default', 'Email', 'Numeric', 'Telephone', 'Text', 'Url', 'Chat'] },
            { name: 'IsPassword', type: 'boolean' },
            { name: 'IsReadOnly', type: 'boolean' },
            { name: 'MaxLength', type: 'number' },
        ]
    },
    {
        name: 'Editor',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A multi-line text input.',
        category: 'Controls',
        properties: [
            { name: 'Text', type: 'string', binding: true, twoWay: true },
            { name: 'Placeholder', type: 'string' },
            { name: 'AutoSize', type: 'enum', values: ['Disabled', 'TextChanges'], defaultValue: 'Disabled' },
            { name: 'HeightRequest', type: 'number' },
        ]
    },
    {
        name: 'CheckBox',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A checkbox control.',
        category: 'Controls',
        properties: [
            { name: 'IsChecked', type: 'boolean', binding: true, twoWay: true, defaultValue: 'False' },
            { name: 'Color', type: 'color' },
        ]
    },
    {
        name: 'Switch',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A toggle switch.',
        category: 'Controls',
        properties: [
            { name: 'IsToggled', type: 'boolean', binding: true, twoWay: true, defaultValue: 'False' },
            { name: 'OnColor', type: 'color' },
            { name: 'ThumbColor', type: 'color' },
        ]
    },
    {
        name: 'Slider',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A slider for selecting a value.',
        category: 'Controls',
        properties: [
            { name: 'Minimum', type: 'number', defaultValue: '0' },
            { name: 'Maximum', type: 'number', defaultValue: '1' },
            { name: 'Value', type: 'number', binding: true, twoWay: true, defaultValue: '0' },
            { name: 'ThumbColor', type: 'color' },
        ]
    },
    {
        name: 'ProgressBar',
        namespace: 'Microsoft.Maui.Controls',
        description: 'Displays progress.',
        category: 'Controls',
        properties: [
            { name: 'Progress', type: 'number', binding: true, defaultValue: '0' },
            { name: 'ProgressColor', type: 'color' },
        ]
    },
    {
        name: 'ActivityIndicator',
        namespace: 'Microsoft.Maui.Controls',
        description: 'Shows that something is running.',
        category: 'Controls',
        properties: [
            { name: 'IsRunning', type: 'boolean', binding: true, defaultValue: 'True' },
            { name: 'Color', type: 'color' },
        ]
    },
    {
        name: 'DatePicker',
        namespace: 'Microsoft.Maui.Controls',
        description: 'Allows date selection.',
        category: 'Controls',
        properties: [
            { name: 'Date', type: 'string', binding: true, twoWay: true },
            { name: 'MinimumDate', type: 'string' },
            { name: 'MaximumDate', type: 'string' },
            { name: 'Format', type: 'string' },
        ]
    },
    {
        name: 'Picker',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A dropdown picker.',
        category: 'Controls',
        properties: [
            { name: 'Title', type: 'string' },
            { name: 'SelectedItem', type: 'object', binding: true, twoWay: true },
            { name: 'SelectedIndex', type: 'number', binding: true, twoWay: true },
            { name: 'ItemsSource', type: 'ienumerable' },
        ]
    },
    {
        name: 'Image',
        namespace: 'Microsoft.Maui.Controls',
        description: 'Displays an image.',
        category: 'Controls',
        properties: [
            { name: 'Source', type: 'image' },
            { name: 'Aspect', type: 'enum', values: ['AspectFit', 'AspectFill', 'Fill'], defaultValue: 'AspectFit' },
        ]
    },
    {
        name: 'WebView',
        namespace: 'Microsoft.Maui.Controls',
        description: 'Displays web content.',
        category: 'Controls',
        properties: [
            { name: 'Source', type: 'string' },
            { name: 'HeightRequest', type: 'number' },
            { name: 'WidthRequest', type: 'number' },
        ]
    },
    {
        name: 'SearchBar',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A search input.',
        category: 'Controls',
        properties: [
            { name: 'Text', type: 'string', binding: true, twoWay: true },
            { name: 'Placeholder', type: 'string' },
            { name: 'Command', type: 'command', binding: true },
        ]
    },

    // ─────────────────────────────────────────────────────────────────────────
    // COLLECTION CONTROLS
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: 'CollectionView',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A performant collection list.',
        category: 'Collections',
        contentProperty: 'EmptyView',
        properties: [
            { name: 'ItemsSource', type: 'ienumerable', binding: true },
            { name: 'ItemTemplate', type: 'datatemplate' },
            { name: 'SelectionMode', type: 'enum', values: ['None', 'Single', 'Multiple'] },
            { name: 'SelectedItem', type: 'object', binding: true, twoWay: true },
            { name: 'SelectedItems', type: 'object' },
            { name: 'Header', type: 'view' },
            { name: 'Footer', type: 'view' },
        ]
    },
    {
        name: 'ListView',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A scrollable list of items.',
        category: 'Collections',
        properties: [
            { name: 'ItemsSource', type: 'ienumerable', binding: true },
            { name: 'ItemTemplate', type: 'datatemplate' },
            { name: 'HasUnevenRows', type: 'boolean', defaultValue: 'False' },
            { name: 'RowHeight', type: 'number', defaultValue: '44' },
            { name: 'SelectedItem', type: 'object', binding: true, twoWay: true },
        ]
    },
    {
        name: 'CarouselView',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A carousel of items.',
        category: 'Collections',
        properties: [
            { name: 'ItemsSource', type: 'ienumerable', binding: true },
            { name: 'ItemTemplate', type: 'datatemplate' },
            { name: 'CurrentItem', type: 'object', binding: true, twoWay: true },
            { name: 'Position', type: 'number', binding: true, twoWay: true },
            { name: 'Loop', type: 'boolean', defaultValue: 'True' },
            { name: 'IndicatorView', type: 'string' },
        ]
    },
    {
        name: 'RefreshView',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A pull-to-refresh container.',
        category: 'Collections',
        properties: [
            { name: 'IsRefreshing', type: 'boolean', binding: true, twoWay: true },
            { name: 'Command', type: 'command', binding: true },
            { name: 'Content', type: 'view' },
        ]
    },

    // ─────────────────────────────────────────────────────────────────────────
    // NAVIGATION
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: 'NavigationPage',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A page with navigation support.',
        category: 'Navigation',
        properties: [
            { name: 'Title', type: 'string', binding: true },
            { name: 'IconImageSource', type: 'image' },
            { name: 'BackButtonTitle', type: 'string' },
        ]
    },
    {
        name: 'TabbedPage',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A page with tabs.',
        category: 'Navigation',
        contentProperty: 'Children',
        properties: [
            { name: 'SelectedTabColor', type: 'color' },
            { name: 'UnselectedTabColor', type: 'color' },
            { name: 'BarBackgroundColor', type: 'color' },
            { name: 'BarTextColor', type: 'color' },
        ]
    },
    {
        name: 'Shell',
        namespace: 'Microsoft.Maui.Controls',
        description: 'Shell provides fundamental navigation and chrome.',
        category: 'Navigation',
        contentProperty: 'Items',
        properties: [
            { name: 'CurrentItem', type: 'object' },
            { name: 'CurrentPage', type: 'object' },
            { name: 'FlyoutIsPresented', type: 'boolean', binding: true, twoWay: true },
        ]
    },

    // ─────────────────────────────────────────────────────────────────────────
    // VISUAL ELEMENTS
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: 'BoxView',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A simple colored rectangle.',
        category: 'Visual',
        properties: [
            { name: 'Color', type: 'color' },
            { name: 'CornerRadius', type: 'number' },
        ]
    },
    {
        name: 'RoundRectangle',
        namespace: 'Microsoft.Maui.Controls.Shapes',
        description: 'A rounded rectangle shape.',
        category: 'Shapes',
        properties: [
            { name: 'CornerRadius', type: 'string' },
        ]
    },

    // ─────────────────────────────────────────────────────────────────────────
    // PAGES
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: 'ContentPage',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A page with a single content view.',
        category: 'Pages',
        contentProperty: 'Content',
        defaultContent: `<ContentPage.Content>
    <StackLayout Padding="20">
        <Label Text="Page Content" />
    </StackLayout>
</ContentPage.Content>`,
        properties: [
            { name: 'Title', type: 'string', binding: true },
            { name: 'BackgroundColor', type: 'color' },
            { name: 'Padding', type: 'string' },
        ]
    },
    {
        name: 'ContentView',
        namespace: 'Microsoft.Maui.Controls',
        description: 'A view with a single content.',
        category: 'Pages',
        contentProperty: 'Content',
        properties: [
            { name: 'BackgroundColor', type: 'color' },
            { name: 'Padding', type: 'string' },
            { name: 'Content', type: 'view' },
        ]
    },
];

// ============================================================================
// FLOWORKS CUSTOM CONTROLS
// ============================================================================

export const FLOWORKS_CUSTOM_CONTROLS: ControlSchema[] = [
    // ─────────────────────────────────────────────────────────────────────────
    // FLOWORKS TABLE CONTROLS
    // ─────────────────────────────────────────────────────────────────────────
    {
        name: 'DataTableView',
        namespace: 'Floworks.MAUI.Views.Controls',
        description: 'Floworks table control with reflection-based rendering, sorting, and selection.',
        category: 'Controls',
        properties: [
            { name: 'Columns', type: 'object', binding: true, description: 'Column definitions for the table' },
            { name: 'ItemsSource', type: 'ienumerable', binding: true, description: 'Data items to display' },
            { name: 'SelectedItem', type: 'object', binding: true, twoWay: true, description: 'Currently selected row item' },
            { name: 'SortCommand', type: 'command', description: 'Command executed when column header is clicked' },
            { name: 'RowTappedCommand', type: 'command', description: 'Command executed when row is tapped' },
            { name: 'EmptyStateMessage', type: 'string', description: 'Message shown when no data' },
            { name: 'IsLoading', type: 'boolean', binding: true, description: 'Shows loading indicator' },
            { name: 'CurrentSortColumn', type: 'string', binding: true, description: 'Currently sorted column key' },
            { name: 'CurrentSortAscending', type: 'boolean', binding: true, description: 'Sort direction' },
        ]
    },
    {
        name: 'StandardFilterBar',
        namespace: 'Floworks.MAUI.Views.Controls',
        description: 'Floworks filter bar with dynamic filter controls.',
        category: 'Controls',
        properties: [
            { name: 'FilterDefinitions', type: 'object', binding: true, description: 'Filter control definitions' },
            { name: 'ApplyFiltersCommand', type: 'command', description: 'Command to apply filters' },
            { name: 'ClearFiltersCommand', type: 'command', description: 'Command to clear all filters' },
            { name: 'AvailableViews', type: 'object', binding: true, description: 'Available view presets' },
            { name: 'SelectedView', type: 'string', binding: true, twoWay: true, description: 'Selected view preset' },
            { name: 'IsLoading', type: 'boolean', binding: true },
        ]
    },
    {
        name: 'StandardActionBar',
        namespace: 'Floworks.MAUI.Views.Controls',
        description: 'Floworks toolbar with CRUD action buttons.',
        category: 'Controls',
        properties: [
            { name: 'ToolbarActions', type: 'object', binding: true, description: 'Action button definitions' },
            { name: 'Capabilities', type: 'object', description: 'Enabled/disabled capabilities' },
        ]
    },
    {
        name: 'MainToolBar',
        namespace: 'Floworks.MAUI.Views.Controls',
        description: 'Main application toolbar.',
        category: 'Controls',
        properties: [
            { name: 'Title', type: 'string' },
            { name: 'ShowBackButton', type: 'boolean' },
        ]
    },
    {
        name: 'ModuleListView',
        namespace: 'Floworks.MAUI.Views.Controls',
        description: 'Module list view for app navigation.',
        category: 'Controls',
        properties: [
            { name: 'ModuleItems', type: 'ienumerable', binding: true },
            { name: 'SelectedModule', type: 'object', binding: true, twoWay: true },
        ]
    },
    {
        name: 'NotificationsPanel',
        namespace: 'Floworks.MAUI.Views.Controls',
        description: 'Notifications panel for system messages.',
        category: 'Controls',
        properties: [
            { name: 'Notifications', type: 'ienumerable', binding: true },
            { name: 'IsVisible', type: 'boolean', binding: true, twoWay: true },
        ]
    },
];

// ============================================================================
// FLOWORKS VIEWMODEL BASE PROPERTIES
// ============================================================================

export interface FloworksViewModelProperty {
    name: string;
    type: string;
    binding: boolean;
    twoWay?: boolean;
    description?: string;
}

export const FLOWORKS_VIEWMODEL_BASE_PROPERTIES: FloworksViewModelProperty[] = [
    // From ModuleListViewModel<T>
    { name: 'Items', type: 'ObservableCollection<T>', binding: true, description: 'All data items' },
    { name: 'FilteredItems', type: 'ObservableCollection<T>', binding: true, description: 'Filtered data items' },
    { name: 'SelectedItem', type: 'T', binding: true, twoWay: true, description: 'Currently selected item' },
    { name: 'HasSelection', type: 'bool', binding: false, description: 'True if an item is selected' },
    { name: 'SearchText', type: 'string', binding: true, twoWay: true, description: 'Search text' },
    { name: 'IsLoading', type: 'bool', binding: true, description: 'Loading state' },
    { name: 'CurrentPage', type: 'int', binding: true, description: 'Current page number' },
    { name: 'PageSize', type: 'int', binding: true, description: 'Items per page' },
    { name: 'TotalRecords', type: 'int', binding: false, description: 'Total record count' },
    { name: 'TotalPages', type: 'int', binding: false, description: 'Total page count' },
    { name: 'PageInfo', type: 'string', binding: false, description: 'Page info text' },
    { name: 'CanGoNextPage', type: 'bool', binding: false, description: 'Can navigate to next page' },
    { name: 'CanGoPreviousPage', type: 'bool', binding: false, description: 'Can navigate to previous page' },
    { name: 'IsEmpty', type: 'bool', binding: false, description: 'True if no records' },
    { name: 'EmptyMessage', type: 'string', binding: false, description: 'Empty state message' },
    { name: 'StatusMessage', type: 'string', binding: true, description: 'Status bar message' },

    // Commands from ModuleListViewModel
    { name: 'LoadDataCommand', type: 'ICommand', binding: false, description: 'Command to reload data' },
    { name: 'AddCommand', type: 'ICommand', binding: false, description: 'Command to add new item' },
    { name: 'EditCommand', type: 'ICommand', binding: false, description: 'Command to edit selected item' },
    { name: 'DeleteCommand', type: 'ICommand', binding: false, description: 'Command to delete selected item' },
    { name: 'DuplicateCommand', type: 'ICommand', binding: false, description: 'Command to duplicate selected item' },
    { name: 'RefreshCommand', type: 'ICommand', binding: false, description: 'Command to refresh data' },
    { name: 'SearchCommand', type: 'ICommand', binding: false, description: 'Command to search' },
    { name: 'NextPageCommand', type: 'ICommand', binding: false, description: 'Navigate to next page' },
    { name: 'PreviousPageCommand', type: 'ICommand', binding: false, description: 'Navigate to previous page' },
    { name: 'ExportCommand', type: 'ICommand', binding: false, description: 'Export data' },

    // From StandardTableViewModel<T>
    { name: 'FilterDefinitions', type: 'ObservableCollection<FilterDefinition>', binding: true, description: 'Filter definitions' },
    { name: 'TableColumns', type: 'ObservableCollection<TableColumnDefinition>', binding: true, description: 'Table column definitions' },
    { name: 'ToolbarActions', type: 'ObservableCollection<ToolbarAction>', binding: true, description: 'Toolbar actions' },
    { name: 'AvailableViews', type: 'ObservableCollection<string>', binding: true, description: 'Available view presets' },
    { name: 'SelectedViewKey', type: 'string', binding: true, twoWay: true, description: 'Selected view preset key' },
    { name: 'SortColumn', type: 'string', binding: true, description: 'Current sort column' },
    { name: 'SortAscending', type: 'boolean', binding: true, description: 'Sort direction' },
    { name: 'ApplyFiltersCommand', type: 'ICommand', binding: false, description: 'Apply filters' },
    { name: 'ClearFiltersCommand', type: 'ICommand', binding: false, description: 'Clear filters' },
    { name: 'SortCommand', type: 'ICommand', binding: false, description: 'Sort by column' },
];

// ============================================================================
// FLOWORKS UI MODEL TYPES
// ============================================================================

export const FLOWORKS_UI_TYPES: ControlSchema[] = [
    {
        name: 'TableColumnDefinition',
        namespace: 'Floworks.MAUI.Models.UI',
        description: 'Defines a column in DataTableView.',
        category: 'Controls',
        properties: [
            { name: 'Key', type: 'string', description: 'Property name on data item' },
            { name: 'Header', type: 'string', description: 'Column header text' },
            { name: 'DataType', type: 'enum', values: ['Text', 'Number', 'Date', 'Boolean', 'Badge', 'Actions'], description: 'How to render the cell' },
            { name: 'Width', type: 'number', description: 'Column width (0=Auto)' },
            { name: 'IsVisible', type: 'boolean', description: 'Column visibility' },
            { name: 'IsSortable', type: 'boolean', description: 'Enable sorting' },
            { name: 'DisplayOrder', type: 'number', description: 'Column order' },
            { name: 'StringFormat', type: 'string', description: 'Format string (e.g., "{0:N2}")' },
            { name: 'BadgeColorPath', type: 'string', description: 'Path to badge color property' },
            { name: 'MinWidth', type: 'number', description: 'Minimum column width' },
        ]
    },
    {
        name: 'FilterDefinition',
        namespace: 'Floworks.MAUI.Models.UI',
        description: 'Defines a filter control in StandardFilterBar.',
        category: 'Controls',
        properties: [
            { name: 'Key', type: 'string', description: 'Filter identifier' },
            { name: 'Label', type: 'string', description: 'Filter label' },
            { name: 'Type', type: 'enum', values: ['TextSearch', 'Picker', 'DateRange', 'Checkbox', 'NumberRange'], description: 'Filter control type' },
            { name: 'Value', type: 'object', binding: true, twoWay: true, description: 'Current filter value' },
            { name: 'DefaultValue', type: 'object', description: 'Default value' },
            { name: 'MinValue', type: 'object', description: 'Minimum for range filters' },
            { name: 'MaxValue', type: 'object', description: 'Maximum for range filters' },
            { name: 'PickerSource', type: 'ienumerable', description: 'Options for picker filters' },
            { name: 'Placeholder', type: 'string', description: 'Placeholder text' },
            { name: 'IsVisible', type: 'boolean', description: 'Filter visibility' },
            { name: 'IsEnabled', type: 'boolean', description: 'Filter enabled state' },
            { name: 'WidthRequest', type: 'number', description: 'Control width hint' },
        ]
    },
    {
        name: 'ToolbarAction',
        namespace: 'Floworks.MAUI.Models',
        description: 'Defines an action button in StandardActionBar.',
        category: 'Controls',
        properties: [
            { name: 'Id', type: 'string', description: 'Action identifier' },
            { name: 'Text', type: 'string', description: 'Button text' },
            { name: 'Icon', type: 'string', description: 'Icon emoji or glyph' },
            { name: 'Tooltip', type: 'string', description: 'Tooltip text' },
            { name: 'Command', type: 'command', binding: true, description: 'Command to execute' },
            { name: 'Group', type: 'string', description: 'Button group' },
            { name: 'SortOrder', type: 'number', description: 'Button sort order' },
            { name: 'BackgroundColor', type: 'color', description: 'Button background color' },
            { name: 'TextColor', type: 'color', description: 'Button text color' },
        ]
    },
];

// ============================================================================
// ALL CONTROLS COMBINED
// ============================================================================

export const ALL_CONTROLS: ControlSchema[] = [
    ...MAUI_BUILTIN_CONTROLS,
    ...FLOWORKS_CUSTOM_CONTROLS,
    ...FLOWORKS_UI_TYPES,
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get all available element suggestions for auto-completion
 */
export function getAllElementSuggestions(): Array<{ label: string; kind: string; detail: string; doc: string }> {
    const suggestions: Array<{ label: string; kind: string; detail: string; doc: string }> = [];

    for (const control of ALL_CONTROLS) {
        suggestions.push({
            label: control.name,
            kind: 'class',
            detail: `${control.namespace} (${control.category})`,
            doc: control.description
        });
    }

    return suggestions;
}

/**
 * Get property suggestions for a specific control
 */
export function getPropertySuggestions(controlName: string): SchemaProperty[] {
    const control = ALL_CONTROLS.find(c => c.name === controlName);
    return control?.properties ?? [];
}

/**
 * Get attached property suggestions for Grid, FlexLayout, etc.
 */
export function getAttachedPropertySuggestions(ownerType: string): AttachedProperty[] {
    const attached: AttachedProperty[] = [];
    for (const control of ALL_CONTROLS) {
        if (control.attachedProperties) {
            attached.push(...control.attachedProperties.filter(p => p.ownerType === ownerType));
        }
    }
    return attached;
}

/**
 * Get binding suggestions based on ViewModel properties
 */
export function getBindingSuggestionsFromViewModel(viewModelProperties: Array<{ name: string; type: string; description?: string }>): Array<{ label: string; insertText: string; detail: string; doc: string }> {
    return viewModelProperties.map(prop => ({
        label: prop.name,
        insertText: `{Binding ${prop.name}}`,
        detail: prop.type,
        doc: prop.description ?? `Bind to ${prop.name}`
    }));
}

/**
 * Search controls by name or namespace
 */
export function searchControls(query: string): ControlSchema[] {
    const q = query.toLowerCase();
    return ALL_CONTROLS.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.namespace.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q)
    );
}
