// Italian, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in it/ is missing here.
import w_account from './it/account.json';
import w_accountErrors from './it/accountErrors.json';
import w_actionbar from './it/actionbar.json';
import w_adminPage from './it/adminPage.json';
import w_aiApps from './it/aiApps.json';
import w_arrangeOptions from './it/arrangeOptions.json';
import w_askDialog from './it/askDialog.json';
import w_assembleTool from './it/assembleTool.json';
import w_backgroundSlice from './it/backgroundSlice.json';
import w_booleanTool from './it/booleanTool.json';
import w_brimEars from './it/brimEars.json';
import w_calibration from './it/calibration.json';
import w_chooseBar from './it/chooseBar.json';
import w_clearance from './it/clearance.json';
import w_colorMixing from './it/colorMixing.json';
import w_colourPicker from './it/colourPicker.json';
import w_common from './it/common.json';
import w_continue from './it/continue.json';
import w_convertDialog from './it/convertDialog.json';
import w_cutTool from './it/cutTool.json';
import w_deviceAddons from './it/deviceAddons.json';
import w_deviceAlertText from './it/deviceAlertText.json';
import w_deviceAlerts from './it/deviceAlerts.json';
import w_deviceArrange from './it/deviceArrange.json';
import w_deviceBrands from './it/deviceBrands.json';
import w_deviceBridge from './it/deviceBridge.json';
import w_deviceCamera from './it/deviceCamera.json';
import w_deviceCards from './it/deviceCards.json';
import w_deviceConsole from './it/deviceConsole.json';
import w_deviceEditor from './it/deviceEditor.json';
import w_deviceFiles from './it/deviceFiles.json';
import w_deviceHeads from './it/deviceHeads.json';
import w_deviceJob from './it/deviceJob.json';
import w_deviceLink from './it/deviceLink.json';
import w_deviceManage from './it/deviceManage.json';
import w_deviceMove from './it/deviceMove.json';
import w_devicePrinterErrors from './it/devicePrinterErrors.json';
import w_deviceScreen from './it/deviceScreen.json';
import w_deviceSend from './it/deviceSend.json';
import w_deviceSlots from './it/deviceSlots.json';
import w_deviceTimelapse from './it/deviceTimelapse.json';
import w_devices from './it/devices.json';
import w_engineSwitch from './it/engineSwitch.json';
import w_filamentLimit from './it/filamentLimit.json';
import w_filamentSync from './it/filamentSync.json';
import w_flowVariant from './it/flowVariant.json';
import w_flushVolumes from './it/flushVolumes.json';
import w_fontList from './it/fontList.json';
import w_gcodeErrors from './it/gcodeErrors.json';
import w_gcodeFallback from './it/gcodeFallback.json';
import w_groupMenu from './it/groupMenu.json';
import w_importPresets from './it/importPresets.json';
import w_language from './it/language.json';
import w_layerCodes from './it/layerCodes.json';
import w_layersPanel from './it/layersPanel.json';
import w_linkProgram from './it/linkProgram.json';
import w_loadingScreen from './it/loadingScreen.json';
import w_measureFigures from './it/measureFigures.json';
import w_objectList from './it/objectList.json';
import w_objectMenu from './it/objectMenu.json';
import w_objectSettings from './it/objectSettings.json';
import w_open from './it/open.json';
import w_openProject from './it/openProject.json';
import w_optionCheck from './it/optionCheck.json';
import w_optionField from './it/optionField.json';
import w_paintTool from './it/paintTool.json';
import w_pickReset from './it/pickReset.json';
import w_plateIcons from './it/plateIcons.json';
import w_plateMenu from './it/plateMenu.json';
import w_plateSettings from './it/plateSettings.json';
import w_presetChanges from './it/presetChanges.json';
import w_presetEngines from './it/presetEngines.json';
import w_presetFiles from './it/presetFiles.json';
import w_presetMenu from './it/presetMenu.json';
import w_presetSave from './it/presetSave.json';
import w_presetSettings from './it/presetSettings.json';
import w_previewColours from './it/previewColours.json';
import w_previewTab from './it/previewTab.json';
import w_printHistory from './it/printHistory.json';
import w_projectImport from './it/projectImport.json';
import w_projectMenu from './it/projectMenu.json';
import w_projectStore from './it/projectStore.json';
import w_saving from './it/saving.json';
import w_settingPicker from './it/settingPicker.json';
import w_settingsCheck from './it/settingsCheck.json';
import w_settingsPanel from './it/settingsPanel.json';
import w_settingsPrompt from './it/settingsPrompt.json';
import w_setupWizard from './it/setupWizard.json';
import w_shapePlacement from './it/shapePlacement.json';
import w_shapes from './it/shapes.json';
import w_sidebar from './it/sidebar.json';
import w_simplifyFirst from './it/simplifyFirst.json';
import w_simplifyTool from './it/simplifyTool.json';
import w_slicerEdits from './it/slicerEdits.json';
import w_slicerNotices from './it/slicerNotices.json';
import w_svgTool from './it/svgTool.json';
import w_tabs from './it/tabs.json';
import w_textTool from './it/textTool.json';
import w_theme from './it/theme.json';
import w_time from './it/time.json';
import w_timeFormat from './it/timeFormat.json';
import w_toolPanel from './it/toolPanel.json';
import w_toolbar from './it/toolbar.json';
import w_topbar from './it/topbar.json';
import w_uiParts from './it/uiParts.json';
import w_viewControls from './it/viewControls.json';
import w_viewport from './it/viewport.json';
import w_volumes from './it/volumes.json';

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
