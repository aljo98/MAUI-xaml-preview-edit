"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntityManager = void 0;
class EntityManager {
    constructor() {
        this.entities = [];
        this.initializeEntities();
    }
    getAvailableEntities() {
        return this.entities;
    }
    getEntityByName(name) {
        return this.entities.find(entity => entity.name === name);
    }
    generateXamlCode(entity, customProperties) {
        let xaml = entity.xamlTemplate;
        // Zamenjaj placeholder-je z dejanskimi vrednostmi
        if (customProperties) {
            for (const [property, value] of Object.entries(customProperties)) {
                const placeholder = `{{${property}}}`;
                xaml = xaml.replace(new RegExp(placeholder, 'g'), value);
            }
        }
        // Odstrani neuporabljene placeholder-je
        xaml = xaml.replace(/\{\{[^}]+\}\}/g, '');
        return xaml;
    }
    initializeEntities() {
        this.entities = [
            // Layout Controls
            {
                name: 'StackLayout',
                description: 'Vertikalno ali horizontalno razporejanje elementov',
                category: 'Layout',
                xamlTemplate: `<StackLayout Orientation="{{Orientation}}" Spacing="{{Spacing}}" Padding="{{Padding}}">
    <Label Text="Element 1" />
    <Label Text="Element 2" />
</StackLayout>`,
                properties: [
                    { name: 'Orientation', type: 'enum', enumValues: ['Vertical', 'Horizontal'], defaultValue: 'Vertical' },
                    { name: 'Spacing', type: 'number', defaultValue: '6' },
                    { name: 'Padding', type: 'string', defaultValue: '0' }
                ]
            },
            {
                name: 'Grid',
                description: 'Mrežno razporejanje elementov v vrstice in stolpce',
                category: 'Layout',
                xamlTemplate: `<Grid RowDefinitions="{{RowDefinitions}}" ColumnDefinitions="{{ColumnDefinitions}}">
    <Label Text="Cell 1" Grid.Row="0" Grid.Column="0" />
    <Label Text="Cell 2" Grid.Row="0" Grid.Column="1" />
    <Label Text="Cell 3" Grid.Row="1" Grid.Column="0" />
    <Label Text="Cell 4" Grid.Row="1" Grid.Column="1" />
</Grid>`,
                properties: [
                    { name: 'RowDefinitions', type: 'string', defaultValue: '*,*' },
                    { name: 'ColumnDefinitions', type: 'string', defaultValue: '*,*' },
                    { name: 'RowSpacing', type: 'number', defaultValue: '6' },
                    { name: 'ColumnSpacing', type: 'number', defaultValue: '6' }
                ]
            },
            {
                name: 'FlexLayout',
                description: 'Fleksibilno razporejanje z možnostjo ovijanja',
                category: 'Layout',
                xamlTemplate: `<FlexLayout Direction="{{Direction}}" Wrap="{{Wrap}}" JustifyContent="{{JustifyContent}}" AlignItems="{{AlignItems}}">
    <Label Text="Flex Item 1" FlexLayout.Grow="1" />
    <Label Text="Flex Item 2" FlexLayout.Grow="1" />
    <Label Text="Flex Item 3" FlexLayout.Grow="1" />
</FlexLayout>`,
                properties: [
                    { name: 'Direction', type: 'enum', enumValues: ['Row', 'Column', 'RowReverse', 'ColumnReverse'], defaultValue: 'Row' },
                    { name: 'Wrap', type: 'enum', enumValues: ['NoWrap', 'Wrap', 'Reverse'], defaultValue: 'NoWrap' },
                    { name: 'JustifyContent', type: 'enum', enumValues: ['Start', 'Center', 'End', 'SpaceBetween', 'SpaceAround', 'SpaceEvenly'], defaultValue: 'Start' },
                    { name: 'AlignItems', type: 'enum', enumValues: ['Start', 'Center', 'End', 'Stretch'], defaultValue: 'Stretch' }
                ]
            },
            {
                name: 'AbsoluteLayout',
                description: 'Absolutno pozicioniranje elementov',
                category: 'Layout',
                xamlTemplate: `<AbsoluteLayout>
    <Label Text="Absolute Position" AbsoluteLayout.LayoutBounds="{{LayoutBounds}}" AbsoluteLayout.LayoutFlags="{{LayoutFlags}}" />
</AbsoluteLayout>`,
                properties: [
                    { name: 'LayoutBounds', type: 'string', defaultValue: '0.5,0.5,100,50' },
                    { name: 'LayoutFlags', type: 'enum', enumValues: ['None', 'XProportional', 'YProportional', 'PositionProportional', 'WidthProportional', 'HeightProportional', 'SizeProportional', 'All'], defaultValue: 'PositionProportional' }
                ]
            },
            // Basic Controls
            {
                name: 'Label',
                description: 'Prikaz besedila',
                category: 'Controls',
                xamlTemplate: `<Label Text="{{Text}}" FontSize="{{FontSize}}" TextColor="{{TextColor}}" HorizontalOptions="{{HorizontalOptions}}" VerticalOptions="{{VerticalOptions}}" />`,
                properties: [
                    { name: 'Text', type: 'string', defaultValue: 'Label Text', required: true },
                    { name: 'FontSize', type: 'number', defaultValue: '16' },
                    { name: 'TextColor', type: 'color', defaultValue: '#000000' },
                    { name: 'HorizontalOptions', type: 'enum', enumValues: ['Start', 'Center', 'End', 'Fill'], defaultValue: 'Start' },
                    { name: 'VerticalOptions', type: 'enum', enumValues: ['Start', 'Center', 'End', 'Fill'], defaultValue: 'Start' }
                ]
            },
            {
                name: 'Button',
                description: 'Gumb za interakcijo',
                category: 'Controls',
                xamlTemplate: `<Button Text="{{Text}}" BackgroundColor="{{BackgroundColor}}" TextColor="{{TextColor}}" CornerRadius="{{CornerRadius}}" Command="{{Command}}" />`,
                properties: [
                    { name: 'Text', type: 'string', defaultValue: 'Button', required: true },
                    { name: 'BackgroundColor', type: 'color', defaultValue: '#2196F3' },
                    { name: 'TextColor', type: 'color', defaultValue: '#FFFFFF' },
                    { name: 'CornerRadius', type: 'number', defaultValue: '6' },
                    { name: 'Command', type: 'string', defaultValue: '' }
                ]
            },
            {
                name: 'Entry',
                description: 'Vnosno polje za besedilo',
                category: 'Controls',
                xamlTemplate: `<Entry Text="{{Text}}" Placeholder="{{Placeholder}}" Keyboard="{{Keyboard}}" IsPassword="{{IsPassword}}" />`,
                properties: [
                    { name: 'Text', type: 'string', defaultValue: '' },
                    { name: 'Placeholder', type: 'string', defaultValue: 'Enter text...' },
                    { name: 'Keyboard', type: 'enum', enumValues: ['Default', 'Email', 'Numeric', 'Telephone', 'Text', 'Url'], defaultValue: 'Default' },
                    { name: 'IsPassword', type: 'boolean', defaultValue: 'False' }
                ]
            },
            {
                name: 'Editor',
                description: 'Večvrstično vnosno polje',
                category: 'Controls',
                xamlTemplate: `<Editor Text="{{Text}}" Placeholder="{{Placeholder}}" AutoSize="{{AutoSize}}" />`,
                properties: [
                    { name: 'Text', type: 'string', defaultValue: '' },
                    { name: 'Placeholder', type: 'string', defaultValue: 'Enter multiline text...' },
                    { name: 'AutoSize', type: 'enum', enumValues: ['None', 'TextChanges'], defaultValue: 'None' }
                ]
            },
            {
                name: 'Image',
                description: 'Prikaz slike',
                category: 'Controls',
                xamlTemplate: `<Image Source="{{Source}}" Aspect="{{Aspect}}" />`,
                properties: [
                    { name: 'Source', type: 'string', defaultValue: 'https://via.placeholder.com/150', required: true },
                    { name: 'Aspect', type: 'enum', enumValues: ['AspectFit', 'AspectFill', 'Fill'], defaultValue: 'AspectFit' }
                ]
            },
            // Selection Controls
            {
                name: 'CheckBox',
                description: 'Potrditveno polje',
                category: 'Selection',
                xamlTemplate: `<CheckBox IsChecked="{{IsChecked}}" Color="{{Color}}" />`,
                properties: [
                    { name: 'IsChecked', type: 'boolean', defaultValue: 'False' },
                    { name: 'Color', type: 'color', defaultValue: '#2196F3' }
                ]
            },
            {
                name: 'Switch',
                description: 'Stikalo za vklop/izklop',
                category: 'Selection',
                xamlTemplate: `<Switch IsToggled="{{IsToggled}}" OnColor="{{OnColor}}" ThumbColor="{{ThumbColor}}" />`,
                properties: [
                    { name: 'IsToggled', type: 'boolean', defaultValue: 'False' },
                    { name: 'OnColor', type: 'color', defaultValue: '#4CAF50' },
                    { name: 'ThumbColor', type: 'color', defaultValue: '#FFFFFF' }
                ]
            },
            {
                name: 'Slider',
                description: 'Drsnik za izbiro vrednosti',
                category: 'Selection',
                xamlTemplate: `<Slider Minimum="{{Minimum}}" Maximum="{{Maximum}}" Value="{{Value}}" />`,
                properties: [
                    { name: 'Minimum', type: 'number', defaultValue: '0' },
                    { name: 'Maximum', type: 'number', defaultValue: '100' },
                    { name: 'Value', type: 'number', defaultValue: '50' }
                ]
            },
            {
                name: 'Stepper',
                description: 'Koračni izbirnik vrednosti',
                category: 'Selection',
                xamlTemplate: `<Stepper Minimum="{{Minimum}}" Maximum="{{Maximum}}" Value="{{Value}}" Increment="{{Increment}}" />`,
                properties: [
                    { name: 'Minimum', type: 'number', defaultValue: '0' },
                    { name: 'Maximum', type: 'number', defaultValue: '100' },
                    { name: 'Value', type: 'number', defaultValue: '0' },
                    { name: 'Increment', type: 'number', defaultValue: '1' }
                ]
            },
            {
                name: 'Picker',
                description: 'Spustni seznam za izbiro',
                category: 'Selection',
                xamlTemplate: `<Picker Title="{{Title}}" SelectedIndex="{{SelectedIndex}}">
    <Picker.ItemsSource>
        <x:Array Type="{x:Type x:String}">
            <x:String>Option 1</x:String>
            <x:String>Option 2</x:String>
            <x:String>Option 3</x:String>
        </x:Array>
    </Picker.ItemsSource>
</Picker>`,
                properties: [
                    { name: 'Title', type: 'string', defaultValue: 'Select an option' },
                    { name: 'SelectedIndex', type: 'number', defaultValue: '-1' }
                ]
            },
            // Collection Controls
            {
                name: 'ListView',
                description: 'Seznam elementov z možnostjo drsenja',
                category: 'Collections',
                xamlTemplate: `<ListView ItemsSource="{{ItemsSource}}" HasUnevenRows="{{HasUnevenRows}}">
    <ListView.ItemTemplate>
        <DataTemplate>
            <ViewCell>
                <StackLayout Padding="15">
                    <Label Text="{Binding Title}" FontSize="16" />
                    <Label Text="{Binding Description}" FontSize="13" TextColor="Gray" />
                </StackLayout>
            </ViewCell>
        </DataTemplate>
    </ListView.ItemTemplate>
</ListView>`,
                properties: [
                    { name: 'ItemsSource', type: 'string', defaultValue: '{Binding Items}' },
                    { name: 'HasUnevenRows', type: 'boolean', defaultValue: 'True' }
                ]
            },
            {
                name: 'CollectionView',
                description: 'Sodobna alternativa ListView z boljšo zmogljivostjo',
                category: 'Collections',
                xamlTemplate: `<CollectionView ItemsSource="{{ItemsSource}}">
    <CollectionView.ItemTemplate>
        <DataTemplate>
            <StackLayout Padding="15">
                <Label Text="{Binding Title}" FontSize="16" />
                <Label Text="{Binding Description}" FontSize="13" TextColor="Gray" />
            </StackLayout>
        </DataTemplate>
    </CollectionView.ItemTemplate>
</CollectionView>`,
                properties: [
                    { name: 'ItemsSource', type: 'string', defaultValue: '{Binding Items}' }
                ]
            },
            {
                name: 'CarouselView',
                description: 'Karuselni prikaz elementov',
                category: 'Collections',
                xamlTemplate: `<CarouselView ItemsSource="{{ItemsSource}}" IndicatorView="{{IndicatorView}}">
    <CarouselView.ItemTemplate>
        <DataTemplate>
            <StackLayout>
                <Frame HasShadow="True" BorderColor="DarkGray" CornerRadius="5" Margin="20" HeightRequest="300">
                    <StackLayout>
                        <Label Text="{Binding Title}" FontSize="Large" HorizontalOptions="Center" />
                        <Image Source="{Binding ImageUrl}" Aspect="AspectFill" HeightRequest="150" WidthRequest="150" />
                        <Label Text="{Binding Description}" FontAttributes="Italic" HorizontalOptions="Center" />
                    </StackLayout>
                </Frame>
            </StackLayout>
        </DataTemplate>
    </CarouselView.ItemTemplate>
</CarouselView>`,
                properties: [
                    { name: 'ItemsSource', type: 'string', defaultValue: '{Binding Items}' },
                    { name: 'IndicatorView', type: 'string', defaultValue: 'indicatorView' }
                ]
            },
            // Visual Elements
            {
                name: 'Frame',
                description: 'Okvir z senco in robovi',
                category: 'Visual',
                xamlTemplate: `<Frame BackgroundColor="{{BackgroundColor}}" BorderColor="{{BorderColor}}" CornerRadius="{{CornerRadius}}" HasShadow="{{HasShadow}}" Padding="{{Padding}}">
    <Label Text="Content inside frame" />
</Frame>`,
                properties: [
                    { name: 'BackgroundColor', type: 'color', defaultValue: '#FFFFFF' },
                    { name: 'BorderColor', type: 'color', defaultValue: '#CCCCCC' },
                    { name: 'CornerRadius', type: 'number', defaultValue: '5' },
                    { name: 'HasShadow', type: 'boolean', defaultValue: 'True' },
                    { name: 'Padding', type: 'string', defaultValue: '10' }
                ]
            },
            {
                name: 'Border',
                description: 'Meja z možnostjo različnih oblik',
                category: 'Visual',
                xamlTemplate: `<Border Stroke="{{Stroke}}" StrokeThickness="{{StrokeThickness}}" StrokeShape="{{StrokeShape}}" Background="{{Background}}">
    <Label Text="Content with border" Margin="10" />
</Border>`,
                properties: [
                    { name: 'Stroke', type: 'color', defaultValue: '#000000' },
                    { name: 'StrokeThickness', type: 'number', defaultValue: '1' },
                    { name: 'StrokeShape', type: 'string', defaultValue: 'Rectangle' },
                    { name: 'Background', type: 'color', defaultValue: 'Transparent' }
                ]
            },
            {
                name: 'BoxView',
                description: 'Enostavna pravokotna barva',
                category: 'Visual',
                xamlTemplate: `<BoxView Color="{{Color}}" WidthRequest="{{WidthRequest}}" HeightRequest="{{HeightRequest}}" />`,
                properties: [
                    { name: 'Color', type: 'color', defaultValue: '#2196F3' },
                    { name: 'WidthRequest', type: 'number', defaultValue: '100' },
                    { name: 'HeightRequest', type: 'number', defaultValue: '100' }
                ]
            },
            // Progress and Activity
            {
                name: 'ProgressBar',
                description: 'Vrstica napredovanja',
                category: 'Progress',
                xamlTemplate: `<ProgressBar Progress="{{Progress}}" ProgressColor="{{ProgressColor}}" />`,
                properties: [
                    { name: 'Progress', type: 'number', defaultValue: '0.5' },
                    { name: 'ProgressColor', type: 'color', defaultValue: '#2196F3' }
                ]
            },
            {
                name: 'ActivityIndicator',
                description: 'Indikator nalaganja',
                category: 'Progress',
                xamlTemplate: `<ActivityIndicator IsRunning="{{IsRunning}}" Color="{{Color}}" />`,
                properties: [
                    { name: 'IsRunning', type: 'boolean', defaultValue: 'True' },
                    { name: 'Color', type: 'color', defaultValue: '#2196F3' }
                ]
            }
        ];
    }
    getEntitiesByCategory(category) {
        return this.entities.filter(entity => entity.category === category);
    }
    getAllCategories() {
        const categories = this.entities.map(entity => entity.category);
        return [...new Set(categories)];
    }
    searchEntities(searchTerm) {
        const term = searchTerm.toLowerCase();
        return this.entities.filter(entity => entity.name.toLowerCase().includes(term) ||
            entity.description.toLowerCase().includes(term) ||
            entity.category.toLowerCase().includes(term));
    }
}
exports.EntityManager = EntityManager;
//# sourceMappingURL=entityManager.js.map