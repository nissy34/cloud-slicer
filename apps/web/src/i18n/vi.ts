// Vietnamese, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in vi/ is missing here.
import w_account from './vi/account.json';
import w_accountErrors from './vi/accountErrors.json';
import w_actionbar from './vi/actionbar.json';
import w_adminPage from './vi/adminPage.json';
import w_aiApps from './vi/aiApps.json';
import w_arrangeOptions from './vi/arrangeOptions.json';
import w_askDialog from './vi/askDialog.json';
import w_assembleTool from './vi/assembleTool.json';
import w_backgroundSlice from './vi/backgroundSlice.json';
import w_booleanTool from './vi/booleanTool.json';
import w_brimEars from './vi/brimEars.json';
import w_calibration from './vi/calibration.json';
import w_chooseBar from './vi/chooseBar.json';
import w_clearance from './vi/clearance.json';
import w_colorMixing from './vi/colorMixing.json';
import w_colourPicker from './vi/colourPicker.json';
import w_common from './vi/common.json';
import w_continue from './vi/continue.json';
import w_convertDialog from './vi/convertDialog.json';
import w_cutTool from './vi/cutTool.json';
import w_deviceAddons from './vi/deviceAddons.json';
import w_deviceAlertText from './vi/deviceAlertText.json';
import w_deviceAlerts from './vi/deviceAlerts.json';
import w_deviceArrange from './vi/deviceArrange.json';
import w_deviceBrands from './vi/deviceBrands.json';
import w_deviceBridge from './vi/deviceBridge.json';
import w_deviceCamera from './vi/deviceCamera.json';
import w_deviceCards from './vi/deviceCards.json';
import w_deviceConsole from './vi/deviceConsole.json';
import w_deviceEditor from './vi/deviceEditor.json';
import w_deviceFiles from './vi/deviceFiles.json';
import w_deviceHeads from './vi/deviceHeads.json';
import w_deviceJob from './vi/deviceJob.json';
import w_deviceLink from './vi/deviceLink.json';
import w_deviceManage from './vi/deviceManage.json';
import w_deviceMove from './vi/deviceMove.json';
import w_devicePrinterErrors from './vi/devicePrinterErrors.json';
import w_deviceScreen from './vi/deviceScreen.json';
import w_deviceSend from './vi/deviceSend.json';
import w_deviceSlots from './vi/deviceSlots.json';
import w_deviceTimelapse from './vi/deviceTimelapse.json';
import w_devices from './vi/devices.json';
import w_engineSwitch from './vi/engineSwitch.json';
import w_filamentLimit from './vi/filamentLimit.json';
import w_filamentSync from './vi/filamentSync.json';
import w_flowVariant from './vi/flowVariant.json';
import w_flushVolumes from './vi/flushVolumes.json';
import w_fontList from './vi/fontList.json';
import w_gcodeErrors from './vi/gcodeErrors.json';
import w_gcodeFallback from './vi/gcodeFallback.json';
import w_groupMenu from './vi/groupMenu.json';
import w_importPresets from './vi/importPresets.json';
import w_language from './vi/language.json';
import w_layerCodes from './vi/layerCodes.json';
import w_layersPanel from './vi/layersPanel.json';
import w_linkProgram from './vi/linkProgram.json';
import w_loadingScreen from './vi/loadingScreen.json';
import w_measureFigures from './vi/measureFigures.json';
import w_objectList from './vi/objectList.json';
import w_objectMenu from './vi/objectMenu.json';
import w_objectSettings from './vi/objectSettings.json';
import w_open from './vi/open.json';
import w_openProject from './vi/openProject.json';
import w_optionCheck from './vi/optionCheck.json';
import w_optionField from './vi/optionField.json';
import w_paintTool from './vi/paintTool.json';
import w_pickReset from './vi/pickReset.json';
import w_plateIcons from './vi/plateIcons.json';
import w_plateMenu from './vi/plateMenu.json';
import w_plateSettings from './vi/plateSettings.json';
import w_presetChanges from './vi/presetChanges.json';
import w_presetEngines from './vi/presetEngines.json';
import w_presetFiles from './vi/presetFiles.json';
import w_presetMenu from './vi/presetMenu.json';
import w_presetSave from './vi/presetSave.json';
import w_presetSettings from './vi/presetSettings.json';
import w_previewColours from './vi/previewColours.json';
import w_previewTab from './vi/previewTab.json';
import w_printHistory from './vi/printHistory.json';
import w_projectImport from './vi/projectImport.json';
import w_projectMenu from './vi/projectMenu.json';
import w_projectStore from './vi/projectStore.json';
import w_saving from './vi/saving.json';
import w_settingPicker from './vi/settingPicker.json';
import w_settingsCheck from './vi/settingsCheck.json';
import w_settingsPanel from './vi/settingsPanel.json';
import w_settingsPrompt from './vi/settingsPrompt.json';
import w_setupWizard from './vi/setupWizard.json';
import w_shapePlacement from './vi/shapePlacement.json';
import w_shapes from './vi/shapes.json';
import w_sidebar from './vi/sidebar.json';
import w_simplifyFirst from './vi/simplifyFirst.json';
import w_simplifyTool from './vi/simplifyTool.json';
import w_slicerEdits from './vi/slicerEdits.json';
import w_slicerNotices from './vi/slicerNotices.json';
import w_svgTool from './vi/svgTool.json';
import w_tabs from './vi/tabs.json';
import w_textTool from './vi/textTool.json';
import w_theme from './vi/theme.json';
import w_time from './vi/time.json';
import w_timeFormat from './vi/timeFormat.json';
import w_toolPanel from './vi/toolPanel.json';
import w_toolbar from './vi/toolbar.json';
import w_topbar from './vi/topbar.json';
import w_uiParts from './vi/uiParts.json';
import w_viewControls from './vi/viewControls.json';
import w_viewport from './vi/viewport.json';
import w_volumes from './vi/volumes.json';

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
