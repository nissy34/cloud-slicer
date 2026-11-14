// Dutch, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in nl/ is missing here.
import w_account from './nl/account.json';
import w_accountErrors from './nl/accountErrors.json';
import w_actionbar from './nl/actionbar.json';
import w_adminPage from './nl/adminPage.json';
import w_aiApps from './nl/aiApps.json';
import w_arrangeOptions from './nl/arrangeOptions.json';
import w_askDialog from './nl/askDialog.json';
import w_assembleTool from './nl/assembleTool.json';
import w_backgroundSlice from './nl/backgroundSlice.json';
import w_booleanTool from './nl/booleanTool.json';
import w_brimEars from './nl/brimEars.json';
import w_calibration from './nl/calibration.json';
import w_chooseBar from './nl/chooseBar.json';
import w_clearance from './nl/clearance.json';
import w_colorMixing from './nl/colorMixing.json';
import w_colourPicker from './nl/colourPicker.json';
import w_common from './nl/common.json';
import w_continue from './nl/continue.json';
import w_convertDialog from './nl/convertDialog.json';
import w_cutTool from './nl/cutTool.json';
import w_deviceAddons from './nl/deviceAddons.json';
import w_deviceAlertText from './nl/deviceAlertText.json';
import w_deviceAlerts from './nl/deviceAlerts.json';
import w_deviceArrange from './nl/deviceArrange.json';
import w_deviceBrands from './nl/deviceBrands.json';
import w_deviceBridge from './nl/deviceBridge.json';
import w_deviceCamera from './nl/deviceCamera.json';
import w_deviceCards from './nl/deviceCards.json';
import w_deviceConsole from './nl/deviceConsole.json';
import w_deviceEditor from './nl/deviceEditor.json';
import w_deviceFiles from './nl/deviceFiles.json';
import w_deviceHeads from './nl/deviceHeads.json';
import w_deviceJob from './nl/deviceJob.json';
import w_deviceLink from './nl/deviceLink.json';
import w_deviceManage from './nl/deviceManage.json';
import w_deviceMove from './nl/deviceMove.json';
import w_devicePrinterErrors from './nl/devicePrinterErrors.json';
import w_deviceScreen from './nl/deviceScreen.json';
import w_deviceSend from './nl/deviceSend.json';
import w_deviceSlots from './nl/deviceSlots.json';
import w_deviceTimelapse from './nl/deviceTimelapse.json';
import w_devices from './nl/devices.json';
import w_engineSwitch from './nl/engineSwitch.json';
import w_filamentLimit from './nl/filamentLimit.json';
import w_filamentSync from './nl/filamentSync.json';
import w_flowVariant from './nl/flowVariant.json';
import w_flushVolumes from './nl/flushVolumes.json';
import w_fontList from './nl/fontList.json';
import w_gcodeErrors from './nl/gcodeErrors.json';
import w_gcodeFallback from './nl/gcodeFallback.json';
import w_groupMenu from './nl/groupMenu.json';
import w_importPresets from './nl/importPresets.json';
import w_language from './nl/language.json';
import w_layerCodes from './nl/layerCodes.json';
import w_layersPanel from './nl/layersPanel.json';
import w_linkProgram from './nl/linkProgram.json';
import w_loadingScreen from './nl/loadingScreen.json';
import w_measureFigures from './nl/measureFigures.json';
import w_objectList from './nl/objectList.json';
import w_objectMenu from './nl/objectMenu.json';
import w_objectSettings from './nl/objectSettings.json';
import w_open from './nl/open.json';
import w_openProject from './nl/openProject.json';
import w_optionCheck from './nl/optionCheck.json';
import w_optionField from './nl/optionField.json';
import w_paintTool from './nl/paintTool.json';
import w_pickReset from './nl/pickReset.json';
import w_plateIcons from './nl/plateIcons.json';
import w_plateMenu from './nl/plateMenu.json';
import w_plateSettings from './nl/plateSettings.json';
import w_presetChanges from './nl/presetChanges.json';
import w_presetEngines from './nl/presetEngines.json';
import w_presetFiles from './nl/presetFiles.json';
import w_presetMenu from './nl/presetMenu.json';
import w_presetSave from './nl/presetSave.json';
import w_presetSettings from './nl/presetSettings.json';
import w_previewColours from './nl/previewColours.json';
import w_previewTab from './nl/previewTab.json';
import w_printHistory from './nl/printHistory.json';
import w_projectImport from './nl/projectImport.json';
import w_projectMenu from './nl/projectMenu.json';
import w_projectStore from './nl/projectStore.json';
import w_saving from './nl/saving.json';
import w_settingPicker from './nl/settingPicker.json';
import w_settingsCheck from './nl/settingsCheck.json';
import w_settingsPanel from './nl/settingsPanel.json';
import w_settingsPrompt from './nl/settingsPrompt.json';
import w_setupWizard from './nl/setupWizard.json';
import w_shapePlacement from './nl/shapePlacement.json';
import w_shapes from './nl/shapes.json';
import w_sidebar from './nl/sidebar.json';
import w_simplifyFirst from './nl/simplifyFirst.json';
import w_simplifyTool from './nl/simplifyTool.json';
import w_slicerEdits from './nl/slicerEdits.json';
import w_slicerNotices from './nl/slicerNotices.json';
import w_svgTool from './nl/svgTool.json';
import w_tabs from './nl/tabs.json';
import w_textTool from './nl/textTool.json';
import w_theme from './nl/theme.json';
import w_time from './nl/time.json';
import w_timeFormat from './nl/timeFormat.json';
import w_toolPanel from './nl/toolPanel.json';
import w_toolbar from './nl/toolbar.json';
import w_topbar from './nl/topbar.json';
import w_uiParts from './nl/uiParts.json';
import w_viewControls from './nl/viewControls.json';
import w_viewport from './nl/viewport.json';
import w_volumes from './nl/volumes.json';

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
