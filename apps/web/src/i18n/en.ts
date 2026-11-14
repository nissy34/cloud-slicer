// Every English word file, listed by name (not import.meta.glob) so code shared with
// Node (the AI app add-on, apps/mcp) and Pages Functions can bundle it too.
// words.test.ts fails when a file in en/ is missing here.
import w_account from './en/account.json';
import w_accountErrors from './en/accountErrors.json';
import w_actionbar from './en/actionbar.json';
import w_adminPage from './en/adminPage.json';
import w_aiApps from './en/aiApps.json';
import w_arrangeOptions from './en/arrangeOptions.json';
import w_askDialog from './en/askDialog.json';
import w_assembleTool from './en/assembleTool.json';
import w_backgroundSlice from './en/backgroundSlice.json';
import w_booleanTool from './en/booleanTool.json';
import w_brimEars from './en/brimEars.json';
import w_calibration from './en/calibration.json';
import w_chooseBar from './en/chooseBar.json';
import w_clearance from './en/clearance.json';
import w_colorMixing from './en/colorMixing.json';
import w_colourPicker from './en/colourPicker.json';
import w_common from './en/common.json';
import w_continue from './en/continue.json';
import w_convertDialog from './en/convertDialog.json';
import w_cutTool from './en/cutTool.json';
import w_deviceAddons from './en/deviceAddons.json';
import w_deviceAlertText from './en/deviceAlertText.json';
import w_deviceAlerts from './en/deviceAlerts.json';
import w_deviceArrange from './en/deviceArrange.json';
import w_deviceBrands from './en/deviceBrands.json';
import w_deviceBridge from './en/deviceBridge.json';
import w_deviceCamera from './en/deviceCamera.json';
import w_deviceCards from './en/deviceCards.json';
import w_deviceConsole from './en/deviceConsole.json';
import w_deviceEditor from './en/deviceEditor.json';
import w_deviceFiles from './en/deviceFiles.json';
import w_deviceHeads from './en/deviceHeads.json';
import w_deviceJob from './en/deviceJob.json';
import w_deviceLink from './en/deviceLink.json';
import w_deviceManage from './en/deviceManage.json';
import w_deviceMove from './en/deviceMove.json';
import w_devicePrinterErrors from './en/devicePrinterErrors.json';
import w_deviceScreen from './en/deviceScreen.json';
import w_deviceSend from './en/deviceSend.json';
import w_deviceSlots from './en/deviceSlots.json';
import w_deviceTimelapse from './en/deviceTimelapse.json';
import w_devices from './en/devices.json';
import w_engineSwitch from './en/engineSwitch.json';
import w_filamentLimit from './en/filamentLimit.json';
import w_filamentSync from './en/filamentSync.json';
import w_flowVariant from './en/flowVariant.json';
import w_flushVolumes from './en/flushVolumes.json';
import w_fontList from './en/fontList.json';
import w_gcodeErrors from './en/gcodeErrors.json';
import w_gcodeFallback from './en/gcodeFallback.json';
import w_groupMenu from './en/groupMenu.json';
import w_importPresets from './en/importPresets.json';
import w_language from './en/language.json';
import w_layerCodes from './en/layerCodes.json';
import w_layersPanel from './en/layersPanel.json';
import w_linkProgram from './en/linkProgram.json';
import w_loadingScreen from './en/loadingScreen.json';
import w_measureFigures from './en/measureFigures.json';
import w_objectList from './en/objectList.json';
import w_objectMenu from './en/objectMenu.json';
import w_objectSettings from './en/objectSettings.json';
import w_open from './en/open.json';
import w_openProject from './en/openProject.json';
import w_optionCheck from './en/optionCheck.json';
import w_optionField from './en/optionField.json';
import w_paintTool from './en/paintTool.json';
import w_pickReset from './en/pickReset.json';
import w_plateIcons from './en/plateIcons.json';
import w_plateMenu from './en/plateMenu.json';
import w_plateSettings from './en/plateSettings.json';
import w_presetChanges from './en/presetChanges.json';
import w_presetEngines from './en/presetEngines.json';
import w_presetFiles from './en/presetFiles.json';
import w_presetMenu from './en/presetMenu.json';
import w_presetSave from './en/presetSave.json';
import w_presetSettings from './en/presetSettings.json';
import w_previewColours from './en/previewColours.json';
import w_previewTab from './en/previewTab.json';
import w_printHistory from './en/printHistory.json';
import w_projectImport from './en/projectImport.json';
import w_projectMenu from './en/projectMenu.json';
import w_projectStore from './en/projectStore.json';
import w_saving from './en/saving.json';
import w_settingPicker from './en/settingPicker.json';
import w_settingsCheck from './en/settingsCheck.json';
import w_settingsPanel from './en/settingsPanel.json';
import w_settingsPrompt from './en/settingsPrompt.json';
import w_setupWizard from './en/setupWizard.json';
import w_shapePlacement from './en/shapePlacement.json';
import w_shapes from './en/shapes.json';
import w_sidebar from './en/sidebar.json';
import w_simplifyFirst from './en/simplifyFirst.json';
import w_simplifyTool from './en/simplifyTool.json';
import w_slicerEdits from './en/slicerEdits.json';
import w_slicerNotices from './en/slicerNotices.json';
import w_svgTool from './en/svgTool.json';
import w_tabs from './en/tabs.json';
import w_textTool from './en/textTool.json';
import w_theme from './en/theme.json';
import w_time from './en/time.json';
import w_timeFormat from './en/timeFormat.json';
import w_toolPanel from './en/toolPanel.json';
import w_toolbar from './en/toolbar.json';
import w_topbar from './en/topbar.json';
import w_uiParts from './en/uiParts.json';
import w_viewControls from './en/viewControls.json';
import w_viewport from './en/viewport.json';
import w_volumes from './en/volumes.json';

export default Object.assign(
  {},
  w_account,
  w_accountErrors,
  w_actionbar,
  w_adminPage,
  w_aiApps,
  w_arrangeOptions,
  w_askDialog,
  w_assembleTool,
  w_backgroundSlice,
  w_booleanTool,
  w_brimEars,
  w_calibration,
  w_chooseBar,
  w_clearance,
  w_colorMixing,
  w_colourPicker,
  w_common,
  w_continue,
  w_convertDialog,
  w_cutTool,
  w_deviceAddons,
  w_deviceAlertText,
  w_deviceAlerts,
  w_deviceArrange,
  w_deviceBrands,
  w_deviceBridge,
  w_deviceCamera,
  w_deviceCards,
  w_deviceConsole,
  w_deviceEditor,
  w_deviceFiles,
  w_deviceHeads,
  w_deviceJob,
  w_deviceLink,
  w_deviceManage,
  w_deviceMove,
  w_devicePrinterErrors,
  w_deviceScreen,
  w_deviceSend,
  w_deviceSlots,
  w_deviceTimelapse,
  w_devices,
  w_engineSwitch,
  w_filamentLimit,
  w_filamentSync,
  w_flowVariant,
  w_flushVolumes,
  w_fontList,
  w_gcodeErrors,
  w_gcodeFallback,
  w_groupMenu,
  w_importPresets,
  w_language,
  w_layerCodes,
  w_layersPanel,
  w_linkProgram,
  w_loadingScreen,
  w_measureFigures,
  w_objectList,
  w_objectMenu,
  w_objectSettings,
  w_open,
  w_openProject,
  w_optionCheck,
  w_optionField,
  w_paintTool,
  w_pickReset,
  w_plateIcons,
  w_plateMenu,
  w_plateSettings,
  w_presetChanges,
  w_presetEngines,
  w_presetFiles,
  w_presetMenu,
  w_presetSave,
  w_presetSettings,
  w_previewColours,
  w_previewTab,
  w_printHistory,
  w_projectImport,
  w_projectMenu,
  w_projectStore,
  w_saving,
  w_settingPicker,
  w_settingsCheck,
  w_settingsPanel,
  w_settingsPrompt,
  w_setupWizard,
  w_shapePlacement,
  w_shapes,
  w_sidebar,
  w_simplifyFirst,
  w_simplifyTool,
  w_slicerEdits,
  w_slicerNotices,
  w_svgTool,
  w_tabs,
  w_textTool,
  w_theme,
  w_time,
  w_timeFormat,
  w_toolPanel,
  w_toolbar,
  w_topbar,
  w_uiParts,
  w_viewControls,
  w_viewport,
  w_volumes,
) as Record<string, unknown>;
