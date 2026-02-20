# MAUI XAML Preview Extension

VS Code ekstenzija za vizualni preview in urejanje XAML datotek iz .NET MAUI projektov z naprednim podporo za vire in stile.

## 🚀 Ključne Funkcionalnosti

- **Vizualni Preview**: Realnočasovni prikaz XAML datotek v simulaciji mobilne naprave
- **🆕 Podpora za Resource Dictionary**: Samodejno nalaganje in razreševanje virov iz App.xaml in drugih virov
- **🆕 StaticResource & DynamicResource**: Popolna podpora za XAML vire in stile
- **🆕 Tema Barv**: Vgrajen sistem barv z MAUI temami in platform-specifičnimi barvami
- **🆕 Napredni Properties Panel**: Podrobne lastnosti elementov organizirane po kategorijah
- **Interaktivno Urejanje**: Kliknite na element za prikaz lastnosti v stranski plošči
- **Knjižnica Elementov**: 20+ vnaprej pripravljenih MAUI kontrolov
- **Simulacija Naprave**: Okvir telefona z možnostjo izbire platforme (Android, iOS, Windows, macOS)
- **🆕 Izboljšano Debugging**: Podrobno beleženje in obvladovanje napak
- **Avtomatsko Osveževanje**: Posodobi se ob vsaki spremembi XAML datoteke

## 🎨 Nova Funkcionalnost - Resource Support

### Samodejno Nalaganje Virov
- Poišče in naloži vire iz `App.xaml`
- Podpira `Resources/` in `Styles/` mape
- Razreši `StaticResource` in `DynamicResource` reference

### ⚡ Hot Reload & Context-Aware Preview (NOVO)
- **Type-as-you-go**: Predogled se osveži samodejno med tipkanjem (brez potrebe po shranjevanju).
- **Context Awareness**: Če urejate `ContentView` ali `Frame`, se prikaže znotraj kontekstnega "Host Page-a", ne več raztegnjen čez cel zaslon.
- **Popup Overlay**: `Popup` elementi se prikažejo kot lebdeča okna s temnim ozadjem.
- **Template Manager**: Ustvarite lastne predloge direktno iz izbrane kode!

### Primer Uporabe
```xaml
<ContentPage.Resources>
    <ResourceDictionary>
        <Color x:Key="PrimaryColor">#512BD4</Color>
        <Style x:Key="HeaderStyle" TargetType="Label">
            <Setter Property="FontSize" Value="24" />
            <Setter Property="TextColor" Value="{StaticResource PrimaryColor}" />
        </Style>
    </ResourceDictionary>
</ContentPage.Resources>

<Label Text="Naslov" Style="{StaticResource HeaderStyle}" />
```

## 📦 Vključeni MAUI Elementi

### Layout Controls
- **StackLayout** - Vertikalno/horizontalno razporejanje
- **Grid** - Mrežno razporejanje v vrstice in stolpce
- **FlexLayout** - Fleksibilno razporejanje z ovijanjem
- **AbsoluteLayout** - Absolutno pozicioniranje

### Basic Controls
- **Label** - Prikaz besedila
- **Button** - Interaktivni gumb
- **Entry** - Enojno vnosno polje
- **Editor** - Večvrstično vnosno polje
- **Image** - Prikaz slik

### Selection Controls
- **CheckBox** - Potrditveno polje
- **Switch** - Stikalo za vklop/izklop
- **Slider** - Drsnik za izbiro vrednosti
- **Stepper** - Koračni izbirnik
- **Picker** - Spustni seznam

### Collection Controls
- **ListView** - Seznam elementov
- **CollectionView** - Sodobna alternativa ListView
- **CarouselView** - Karuselni prikaz

### Visual Elements
- **Frame** - Okvir z senco in robovi
- **Border** - Meja z različnimi oblikami
- **BoxView** - Enostavna barvna površina

### Progress Controls
- **ProgressBar** - Vrstica napredovanja
- **ActivityIndicator** - Indikator nalaganja

## 🛠️ Namestitev

1. **Kopiraj ekstenzijo** v VS Code extensions mapo
2. **Namesti odvisnosti**:
   ```bash
   cd maui-xaml-preview
   npm install
   ```
3. **Kompajliraj**:
   ```bash
   npm run compile
   ```
4. **Testiraj** z F5 (Debug mode)

## 📖 Uporaba

### Odpiranje Preview-ja
1. Odpri XAML datoteko v VS Code
2. Pritisni `Ctrl+Shift+P` in vnesi `MAUI: Odpri XAML Preview`
3. Ali pa uporabi ukaz iz Command Palette

### Dodajanje Elementov
1. Postavi kurzor v XAML datoteko kjer želiš dodati element
2. Pritisni `Ctrl+Shift+P` in vnesi `MAUI: Dodaj entiteto`
3. Izberi željen element iz seznama
4. Element se samodejno doda v XAML

### Vizualno Urejanje
1. V preview oknu klikni na kateri koli element
2. V Properties panelu uredi lastnosti
3. Spremembr se samodejno odražajo v XAML

## 🎯 Primer XAML datoteke

```xml
<?xml version="1.0" encoding="utf-8" ?>
<ContentPage xmlns="http://schemas.microsoft.com/dotnet/2021/maui"
             xmlns:x="http://schemas.microsoft.com/winfx/2009/xaml"
             x:Class="MauiApp.MainPage"
             Title="MainPage">

    <StackLayout Spacing="25" Padding="30,0" VerticalOptions="Center">

        <Image Source="dotnet_bot.png"
               HeightRequest="185"
               Aspect="AspectFit" />

        <Label x:Name="CounterLabel"
               Text="Hello, World!"
               FontSize="18"
               HorizontalOptions="Center" />

        <Button x:Name="CounterBtn"
                Text="Click me"
                BackgroundColor="#2196F3"
                TextColor="White"
                CornerRadius="6" />

        <Entry Placeholder="Enter your name..."
               BackgroundColor="#F5F5F5" />

    </StackLayout>

</ContentPage>
```

## 🔧 Razvoj

### Struktura Projekta
```
maui-xaml-preview/
├── src/
│   ├── extension.ts         # Glavna logika ekstenzije
│   ├── previewProvider.ts   # HTML preview z interaktivnostjo
│   └── entityManager.ts     # Upravljanje MAUI elementov
├── out/                     # Kompajlirane JS datoteke
├── package.json            # Konfiguracija ekstenzije
└── tsconfig.json          # TypeScript nastavitve
```

### Dodajanje Novih Elementov

Za dodajanje novega MAUI elementa v `entityManager.ts`:

```typescript
{
    name: 'NoviElement',
    description: 'Opis novega elementa',
    category: 'Kategorija',
    xamlTemplate: `<NoviElement Property="{{Property}}">
        <!-- Vsebina -->
    </NoviElement>`,
    properties: [
        { name: 'Property', type: 'string', defaultValue: 'Default' }
    ]
}
```

## 🐛 Znane Omejitve

- Trenutno podpira samo osnovne MAUI elemente
- Kompleksni data binding še ni podprt
- Custom kontrole niso vključene

## 📝 Licenca

MIT License - Glej LICENSE datoteko za podrobnosti.

## 🤝 Prispevki

Prispevki so dobrodošli! Prosimo odprite issue ali pull request.

---

**Uživajte v razvoju MAUI aplikacij z vizualnim preview-jem!** 🎉