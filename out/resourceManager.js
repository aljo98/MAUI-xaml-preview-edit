"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResourceManager = void 0;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const fast_xml_parser_1 = require("fast-xml-parser");
// Resource dictionary manager for XAML files
class ResourceManager {
    constructor() {
        this.resourceCache = new Map();
        this.styleCache = new Map();
        this.xmlParser = new fast_xml_parser_1.XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: '@_',
            textNodeName: '#text',
            parseTagValue: false,
            parseAttributeValue: false,
            trimValues: true,
            removeNSPrefix: false,
            allowBooleanAttributes: true
        });
        console.log('[ResourceManager] Initialized');
    }
    async loadResourcesForFile(xamlFilePath) {
        console.log(`[ResourceManager] Loading resources for: ${xamlFilePath}`);
        const allResources = [];
        const allStyles = [];
        try {
            // Load resources from the file itself
            const fileResources = await this.loadResourcesFromFile(xamlFilePath);
            allResources.push(...fileResources.resources);
            allStyles.push(...fileResources.styles);
            // Load App.xaml resources
            const appXamlPath = this.findAppXaml(xamlFilePath);
            if (appXamlPath && appXamlPath !== xamlFilePath) {
                const appResources = await this.loadResourcesFromFile(appXamlPath);
                allResources.push(...appResources.resources);
                allStyles.push(...appResources.styles);
            }
            // Look for additional resource dictionaries
            const resourceDictPaths = await this.findResourceDictionaries(xamlFilePath);
            for (const dictPath of resourceDictPaths) {
                if (dictPath !== xamlFilePath && dictPath !== appXamlPath) {
                    const dictResources = await this.loadResourcesFromFile(dictPath);
                    allResources.push(...dictResources.resources);
                    allStyles.push(...dictResources.styles);
                }
            }
            console.log(`[ResourceManager] Loaded ${allResources.length} resources and ${allStyles.length} styles`);
            return { resources: allResources, styles: allStyles };
        }
        catch (error) {
            console.error('[ResourceManager] Error loading resources:', error);
            return { resources: [], styles: [] };
        }
    }
    async loadResourcesFromFile(filePath) {
        if (this.resourceCache.has(filePath)) {
            const cachedResources = this.resourceCache.get(filePath) || [];
            const cachedStyles = this.styleCache.get(filePath) || [];
            return { resources: cachedResources, styles: cachedStyles };
        }
        try {
            if (!fs.existsSync(filePath)) {
                console.log(`[ResourceManager] File not found: ${filePath}`);
                return { resources: [], styles: [] };
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            const parsed = this.xmlParser.parse(content);
            const resources = this.extractResources(parsed);
            const styles = this.extractStyles(parsed);
            // Cache the results
            this.resourceCache.set(filePath, resources);
            this.styleCache.set(filePath, styles);
            console.log(`[ResourceManager] Loaded from ${path.basename(filePath)}: ${resources.length} resources, ${styles.length} styles`);
            return { resources, styles };
        }
        catch (error) {
            console.error(`[ResourceManager] Error parsing ${filePath}:`, error);
            return { resources: [], styles: [] };
        }
    }
    extractResources(parsedXml) {
        const resources = [];
        const findResourceDictionaries = (obj) => {
            if (!obj || typeof obj !== 'object')
                return;
            // Look for ResourceDictionary elements
            if (obj['ResourceDictionary'] || obj['Application.Resources'] || obj['ContentPage.Resources'] || obj['Grid.Resources']) {
                const resourceDict = obj['ResourceDictionary'] || obj['Application.Resources'] || obj['ContentPage.Resources'] || obj['Grid.Resources'];
                this.processResourceDictionary(resourceDict, resources);
            }
            // Recursively search in all properties
            for (const key in obj) {
                if (key.includes('Resources')) {
                    this.processResourceDictionary(obj[key], resources);
                }
                findResourceDictionaries(obj[key]);
            }
        };
        findResourceDictionaries(parsedXml);
        return resources;
    }
    extractStyles(parsedXml) {
        const styles = [];
        const findStyles = (obj) => {
            if (!obj || typeof obj !== 'object')
                return;
            // Look for Style elements
            if (obj['Style']) {
                const styleArray = Array.isArray(obj['Style']) ? obj['Style'] : [obj['Style']];
                for (const style of styleArray) {
                    const styleResource = this.parseStyle(style);
                    if (styleResource) {
                        styles.push(styleResource);
                    }
                }
            }
            // Recursively search
            for (const key in obj) {
                findStyles(obj[key]);
            }
        };
        findStyles(parsedXml);
        return styles;
    }
    processResourceDictionary(resourceDict, resources) {
        if (!resourceDict)
            return;
        for (const key in resourceDict) {
            if (key.startsWith('@_'))
                continue; // Skip attributes
            const items = Array.isArray(resourceDict[key]) ? resourceDict[key] : [resourceDict[key]];
            for (const item of items) {
                if (item && typeof item === 'object' && item['@_x:Key']) {
                    const resourceKey = item['@_x:Key'];
                    let resourceValue = '';
                    let resourceType = 'Other';
                    if (key === 'Color') {
                        resourceValue = item['#text'] || item.toString();
                        resourceType = 'Color';
                    }
                    else if (key === 'SolidColorBrush') {
                        // Handle SolidColorBrush Color attribute or inner text
                        resourceValue = item['@_Color'] || item['Color'] || item['#text'] || '';
                        resourceType = 'Color';
                    }
                    else if (key === 'Style') {
                        resourceValue = JSON.stringify(item);
                        resourceType = 'Style';
                    }
                    else if (key === 'DataTemplate') {
                        resourceValue = JSON.stringify(item);
                        resourceType = 'DataTemplate';
                    }
                    else if (key === 'ControlTemplate') {
                        resourceValue = JSON.stringify(item);
                        resourceType = 'ControlTemplate';
                    }
                    else {
                        resourceValue = item['#text'] || JSON.stringify(item);
                    }
                    resources.push({
                        key: resourceKey,
                        value: resourceValue,
                        type: resourceType
                    });
                }
            }
        }
    }
    parseStyle(styleObj) {
        if (!styleObj || !styleObj['@_TargetType'])
            return null;
        const style = {
            key: styleObj['@_x:Key'] || '',
            targetType: styleObj['@_TargetType'],
            setters: {}
        };
        if (styleObj['Setter']) {
            const setters = Array.isArray(styleObj['Setter']) ? styleObj['Setter'] : [styleObj['Setter']];
            for (const setter of setters) {
                if (setter['@_Property'] && setter['@_Value']) {
                    style.setters[setter['@_Property']] = setter['@_Value'];
                }
            }
        }
        return style;
    }
    findAppXaml(currentFilePath) {
        let dir = path.dirname(currentFilePath);
        const maxLevels = 5; // Prevent infinite loops
        let level = 0;
        while (level < maxLevels) {
            const appXamlPath = path.join(dir, 'App.xaml');
            if (fs.existsSync(appXamlPath)) {
                console.log(`[ResourceManager] Found App.xaml at: ${appXamlPath}`);
                return appXamlPath;
            }
            const parentDir = path.dirname(dir);
            if (parentDir === dir)
                break; // Reached root
            dir = parentDir;
            level++;
        }
        console.log('[ResourceManager] App.xaml not found');
        return null;
    }
    async findResourceDictionaries(currentFilePath) {
        const resourcePaths = [];
        const dir = path.dirname(currentFilePath);
        // Common resource dictionary file patterns
        const patterns = [
            '**/Resources/*.xaml',
            '**/Styles/*.xaml',
            '**/Themes/*.xaml',
            '**/*Dictionary.xaml',
            '**/*Resources.xaml'
        ];
        try {
            const files = await vscode.workspace.findFiles(`{${patterns.join(',')}}`, '**/node_modules/**', 50);
            for (const file of files) {
                resourcePaths.push(file.fsPath);
            }
            console.log(`[ResourceManager] Found ${resourcePaths.length} potential resource dictionaries`);
        }
        catch (error) {
            console.error('[ResourceManager] Error finding resource dictionaries:', error);
        }
        return resourcePaths;
    }
    resolveStaticResource(resourceKey, resources) {
        const resource = resources.find(r => r.key === resourceKey);
        if (resource) {
            console.log(`[ResourceManager] Resolved StaticResource ${resourceKey} = ${resource.value}`);
            return resource.value;
        }
        console.log(`[ResourceManager] StaticResource ${resourceKey} not found`);
        return null;
    }
    resolveStyleResource(styleKey, styles) {
        const style = styles.find(s => s.key === styleKey);
        if (style) {
            console.log(`[ResourceManager] Resolved Style ${styleKey} for ${style.targetType}`);
            return style;
        }
        console.log(`[ResourceManager] Style ${styleKey} not found`);
        return null;
    }
    clearCache() {
        this.resourceCache.clear();
        this.styleCache.clear();
        console.log('[ResourceManager] Cache cleared');
    }
}
exports.ResourceManager = ResourceManager;
//# sourceMappingURL=resourceManager.js.map