// Catalan, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in ca/ is missing here.
import w_account from './ca/account.json';
import w_accountErrors from './ca/accountErrors.json';
import w_actionbar from './ca/actionbar.json';
import w_adminPage from './ca/adminPage.json';
import w_aiApps from './ca/aiApps.json';
import w_arrangeOptions from './ca/arrangeOptions.json';
import w_askDialog from './ca/askDialog.json';
import w_assembleTool from './ca/assembleTool.json';
import w_backgroundSlice from './ca/backgroundSlice.json';
import w_booleanTool from './ca/booleanTool.json';
import w_brimEars from './ca/brimEars.json';
import w_calibration from './ca/calibration.json';
import w_chooseBar from './ca/chooseBar.json';
import w_clearance from './ca/clearance.json';
import w_colorMixing from './ca/colorMixing.json';
import w_colourPicker from './ca/colourPicker.json';
import w_common from './ca/common.json';
import w_continue from './ca/continue.json';
import w_convertDialog from './ca/convertDialog.json';
import w_cutTool from './ca/cutTool.json';
import w_deviceAddons from './ca/deviceAddons.json';
import w_deviceAlertText from './ca/deviceAlertText.json';
import w_deviceAlerts from './ca/deviceAlerts.json';
import w_deviceArrange from './ca/deviceArrange.json';
import w_deviceBrands from './ca/deviceBrands.json';
import w_deviceBridge from './ca/deviceBridge.json';
import w_deviceCamera from './ca/deviceCamera.json';
import w_deviceCards from './ca/deviceCards.json';
import w_deviceConsole from './ca/deviceConsole.json';
import w_deviceEditor from './ca/deviceEditor.json';
import w_deviceFiles from './ca/deviceFiles.json';
import w_deviceHeads from './ca/deviceHeads.json';
import w_deviceJob from './ca/deviceJob.json';
import w_deviceLink from './ca/deviceLink.json';
import w_deviceManage from './ca/deviceManage.json';
import w_deviceMove from './ca/deviceMove.json';
import w_devicePrinterErrors from './ca/devicePrinterErrors.json';
import w_deviceScreen from './ca/deviceScreen.json';
import w_deviceSend from './ca/deviceSend.json';
import w_deviceSlots from './ca/deviceSlots.json';
import w_deviceTimelapse from './ca/deviceTimelapse.json';
import w_devices from './ca/devices.json';
import w_engineSwitch from './ca/engineSwitch.json';
import w_filamentLimit from './ca/filamentLimit.json';
import w_filamentSync from './ca/filamentSync.json';
import w_flowVariant from './ca/flowVariant.json';
import w_flushVolumes from './ca/flushVolumes.json';
import w_fontList from './ca/fontList.json';
import w_gcodeErrors from './ca/gcodeErrors.json';
import w_gcodeFallback from './ca/gcodeFallback.json';
import w_groupMenu from './ca/groupMenu.json';
import w_importPresets from './ca/importPresets.json';
import w_language from './ca/language.json';
import w_layerCodes from './ca/layerCodes.json';
import w_layersPanel from './ca/layersPanel.json';
import w_linkProgram from './ca/linkProgram.json';
import w_loadingScreen from './ca/loadingScreen.json';
import w_measureFigures from './ca/measureFigures.json';
import w_objectList from './ca/objectList.json';
import w_objectMenu from './ca/objectMenu.json';
import w_objectSettings from './ca/objectSettings.json';
import w_open from './ca/open.json';
import w_openProject from './ca/openProject.json';
import w_optionCheck from './ca/optionCheck.json';
import w_optionField from './ca/optionField.json';
import w_paintTool from './ca/paintTool.json';
import w_pickReset from './ca/pickReset.json';
import w_plateIcons from './ca/plateIcons.json';
import w_plateMenu from './ca/plateMenu.json';
import w_plateSettings from './ca/plateSettings.json';
import w_presetChanges from './ca/presetChanges.json';
import w_presetEngines from './ca/presetEngines.json';
import w_presetFiles from './ca/presetFiles.json';
import w_presetMenu from './ca/presetMenu.json';
import w_presetSave from './ca/presetSave.json';
import w_presetSettings from './ca/presetSettings.json';
import w_previewColours from './ca/previewColours.json';
import w_previewTab from './ca/previewTab.json';
import w_printHistory from './ca/printHistory.json';
import w_projectImport from './ca/projectImport.json';
import w_projectMenu from './ca/projectMenu.json';
import w_projectStore from './ca/projectStore.json';
import w_saving from './ca/saving.json';
import w_settingPicker from './ca/settingPicker.json';
import w_settingsCheck from './ca/settingsCheck.json';
import w_settingsPanel from './ca/settingsPanel.json';
import w_settingsPrompt from './ca/settingsPrompt.json';
import w_setupWizard from './ca/setupWizard.json';
import w_shapePlacement from './ca/shapePlacement.json';
import w_shapes from './ca/shapes.json';
import w_sidebar from './ca/sidebar.json';
import w_simplifyFirst from './ca/simplifyFirst.json';
import w_simplifyTool from './ca/simplifyTool.json';
import w_slicerEdits from './ca/slicerEdits.json';
import w_slicerNotices from './ca/slicerNotices.json';
import w_svgTool from './ca/svgTool.json';
import w_tabs from './ca/tabs.json';
import w_textTool from './ca/textTool.json';
import w_theme from './ca/theme.json';
import w_time from './ca/time.json';
import w_timeFormat from './ca/timeFormat.json';
import w_toolPanel from './ca/toolPanel.json';
import w_toolbar from './ca/toolbar.json';
import w_topbar from './ca/topbar.json';
import w_uiParts from './ca/uiParts.json';
import w_viewControls from './ca/viewControls.json';
import w_viewport from './ca/viewport.json';
import w_volumes from './ca/volumes.json';

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
