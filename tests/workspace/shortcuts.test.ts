import assert from 'node:assert/strict';
import { test } from 'node:test';
import { defaultShortcuts, parseShortcuts, shortcutCommand, shortcutCommands, shortcutError, shortcutKey } from '../../src/features/workspace/shared/shortcuts';
import { parseInterfacePreferences } from '../../src/features/workspace/shared/interface-preferences';
import { createDocumentEditor } from '../../src/features/workspace/editor/editor-kit';
test('all current commands have unique platform defaults with no reserved conflicts',()=>{
 for(const platform of ['mac','other'] as const){const map=defaultShortcuts(platform);assert.equal(shortcutError(map,platform),'');assert.equal(Object.keys(map).length,shortcutCommands.length);assert.equal(new Set(Object.values(map).map(v=>shortcutKey(v!))).size,shortcutCommands.length);}
});
test('custom maps reject collisions, browser bindings and malformed keys; clearing remains disabled',()=>{
 const map=defaultShortcuts('other');assert(shortcutError({...map,italic:map.bold},'other'));assert(shortcutError({...map,bold:{...map.bold!,code:'KeyW'}},'other'));assert(shortcutError({...map,bold:{...map.bold!,ctrl:false}},'other'));
 const disabled={...map,bold:null};assert.equal(shortcutError(disabled,'other'),'');assert.equal(parseShortcuts(disabled,'other').bold,null);
 const preferences=parseInterfacePreferences(JSON.stringify({showWords:false,history:{batches:99,documentMiB:32,pageMiB:16},shortcuts:{other:disabled}}));assert.equal(preferences.showWords,false);assert.equal(preferences.showReadingTime,true);assert.equal(preferences.history.documentMiB,16);assert.equal(preferences.shortcuts.other.bold,null);assert(preferences.shortcuts.mac.bold);
});
test('dispatcher uses physical codes and ignores composition, repeats and AltGraph',()=>{
 const map=defaultShortcuts('other');const event={code:'KeyB',key:'中',ctrlKey:true,metaKey:false,altKey:false,shiftKey:false,isComposing:false,repeat:false,getModifierState:()=>false} as unknown as KeyboardEvent;
 assert.equal(shortcutCommand(event,map),'bold');assert.equal(shortcutCommand({...event,isComposing:true} as KeyboardEvent,map),undefined);assert.equal(shortcutCommand({...event,repeat:true} as KeyboardEvent,map),undefined);assert.equal(shortcutCommand({...event,getModifierState:()=>true} as KeyboardEvent,map),undefined);assert.equal(shortcutCommand(event,{...map,bold:null}),undefined);
});
test('workspace no longer installs the replaced Plate format shortcuts; keeps exit-break',()=>{
 const {editor}=createDocumentEditor({path:'a.md',content:'hello',version:'1'},{root:'/isolated',id:'test',name:'test'});
 assert.deepEqual(Object.keys(editor.meta.shortcuts).sort(),['exitBreak.insert','exitBreak.insertBefore']);
});
