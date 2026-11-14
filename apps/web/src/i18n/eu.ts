// Basque, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in eu/ is missing here.
import w_account from './eu/account.json';
import w_accountErrors from './eu/accountErrors.json';
import w_actionbar from './eu/actionbar.json';
import w_adminPage from './eu/adminPage.json';
import w_aiApps from './eu/aiApps.json';
import w_arrangeOptions from './eu/arrangeOptions.json';
import w_askDialog from './eu/askDialog.json';
import w_assembleTool from './eu/assembleTool.json';
import w_backgroundSlice from './eu/backgroundSlice.json';
import w_booleanTool from './eu/booleanTool.json';
import w_brimEars from './eu/brimEars.json';
import w_calibration from './eu/calibration.json';
import w_chooseBar from './eu/chooseBar.json';
import w_clearance from './eu/clearance.json';
import w_colorMixing from './eu/colorMixing.json';
import w_colourPicker from './eu/colourPicker.json';
import w_common from './eu/common.json';
import w_continue from './eu/continue.json';
import w_convertDialog from './eu/convertDialog.json';
import w_cutTool from './eu/cutTool.json';
import w_deviceAddons from './eu/deviceAddons.json';
import w_deviceAlertText from './eu/deviceAlertText.json';
import w_deviceAlerts from './eu/deviceAlerts.json';
import w_deviceArrange from './eu/deviceArrange.json';
import w_deviceBrands from './eu/deviceBrands.json';
import w_deviceBridge from './eu/deviceBridge.json';
import w_deviceCamera from './eu/deviceCamera.json';
import w_deviceCards from './eu/deviceCards.json';
import w_deviceConsole from './eu/deviceConsole.json';
import w_deviceEditor from './eu/deviceEditor.json';
import w_deviceFiles from './eu/deviceFiles.json';
import w_deviceHeads from './eu/deviceHeads.json';
import w_deviceJob from './eu/deviceJob.json';
import w_deviceLink from './eu/deviceLink.json';
import w_deviceManage from './eu/deviceManage.json';
import w_deviceMove from './eu/deviceMove.json';
import w_devicePrinterErrors from './eu/devicePrinterErrors.json';
import w_deviceScreen from './eu/deviceScreen.json';
import w_deviceSend from './eu/deviceSend.json';
import w_deviceSlots from './eu/deviceSlots.json';
import w_deviceTimelapse from './eu/deviceTimelapse.json';
import w_devices from './eu/devices.json';
import w_engineSwitch from './eu/engineSwitch.json';
import w_filamentLimit from './eu/filamentLimit.json';
import w_filamentSync from './eu/filamentSync.json';
import w_flowVariant from './eu/flowVariant.json';
import w_flushVolumes from './eu/flushVolumes.json';
import w_fontList from './eu/fontList.json';
import w_gcodeErrors from './eu/gcodeErrors.json';
import w_gcodeFallback from './eu/gcodeFallback.json';
import w_groupMenu from './eu/groupMenu.json';
import w_importPresets from './eu/importPresets.json';
import w_language from './eu/language.json';
import w_layerCodes from './eu/layerCodes.json';
import w_layersPanel from './eu/layersPanel.json';
import w_linkProgram from './eu/linkProgram.json';
import w_loadingScreen from './eu/loadingScreen.json';
import w_measureFigures from './eu/measureFigures.json';
import w_objectList from './eu/objectList.json';
import w_objectMenu from './eu/objectMenu.json';
import w_objectSettings from './eu/objectSettings.json';
import w_open from './eu/open.json';
import w_openProject from './eu/openProject.json';
import w_optionCheck from './eu/optionCheck.json';
import w_optionField from './eu/optionField.json';
import w_paintTool from './eu/paintTool.json';
import w_pickReset from './eu/pickReset.json';
import w_plateIcons from './eu/plateIcons.json';
import w_plateMenu from './eu/plateMenu.json';
import w_plateSettings from './eu/plateSettings.json';
import w_presetChanges from './eu/presetChanges.json';
import w_presetEngines from './eu/presetEngines.json';
import w_presetFiles from './eu/presetFiles.json';
import w_presetMenu from './eu/presetMenu.json';
import w_presetSave from './eu/presetSave.json';
import w_presetSettings from './eu/presetSettings.json';
import w_previewColours from './eu/previewColours.json';
import w_previewTab from './eu/previewTab.json';
import w_printHistory from './eu/printHistory.json';
import w_projectImport from './eu/projectImport.json';
import w_projectMenu from './eu/projectMenu.json';
import w_projectStore from './eu/projectStore.json';
import w_saving from './eu/saving.json';
import w_settingPicker from './eu/settingPicker.json';
import w_settingsCheck from './eu/settingsCheck.json';
import w_settingsPanel from './eu/settingsPanel.json';
import w_settingsPrompt from './eu/settingsPrompt.json';
import w_setupWizard from './eu/setupWizard.json';
import w_shapePlacement from './eu/shapePlacement.json';
import w_shapes from './eu/shapes.json';
import w_sidebar from './eu/sidebar.json';
import w_simplifyFirst from './eu/simplifyFirst.json';
import w_simplifyTool from './eu/simplifyTool.json';
import w_slicerEdits from './eu/slicerEdits.json';
import w_slicerNotices from './eu/slicerNotices.json';
import w_svgTool from './eu/svgTool.json';
import w_tabs from './eu/tabs.json';
import w_textTool from './eu/textTool.json';
import w_theme from './eu/theme.json';
import w_time from './eu/time.json';
import w_timeFormat from './eu/timeFormat.json';
import w_toolPanel from './eu/toolPanel.json';
import w_toolbar from './eu/toolbar.json';
import w_topbar from './eu/topbar.json';
import w_uiParts from './eu/uiParts.json';
import w_viewControls from './eu/viewControls.json';
import w_viewport from './eu/viewport.json';
import w_volumes from './eu/volumes.json';

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
