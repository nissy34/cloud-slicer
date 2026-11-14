// Czech, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in cs/ is missing here.
import w_account from './cs/account.json';
import w_accountErrors from './cs/accountErrors.json';
import w_actionbar from './cs/actionbar.json';
import w_adminPage from './cs/adminPage.json';
import w_aiApps from './cs/aiApps.json';
import w_arrangeOptions from './cs/arrangeOptions.json';
import w_askDialog from './cs/askDialog.json';
import w_assembleTool from './cs/assembleTool.json';
import w_backgroundSlice from './cs/backgroundSlice.json';
import w_booleanTool from './cs/booleanTool.json';
import w_brimEars from './cs/brimEars.json';
import w_calibration from './cs/calibration.json';
import w_chooseBar from './cs/chooseBar.json';
import w_clearance from './cs/clearance.json';
import w_colorMixing from './cs/colorMixing.json';
import w_colourPicker from './cs/colourPicker.json';
import w_common from './cs/common.json';
import w_continue from './cs/continue.json';
import w_convertDialog from './cs/convertDialog.json';
import w_cutTool from './cs/cutTool.json';
import w_deviceAddons from './cs/deviceAddons.json';
import w_deviceAlertText from './cs/deviceAlertText.json';
import w_deviceAlerts from './cs/deviceAlerts.json';
import w_deviceArrange from './cs/deviceArrange.json';
import w_deviceBrands from './cs/deviceBrands.json';
import w_deviceBridge from './cs/deviceBridge.json';
import w_deviceCamera from './cs/deviceCamera.json';
import w_deviceCards from './cs/deviceCards.json';
import w_deviceConsole from './cs/deviceConsole.json';
import w_deviceEditor from './cs/deviceEditor.json';
import w_deviceFiles from './cs/deviceFiles.json';
import w_deviceHeads from './cs/deviceHeads.json';
import w_deviceJob from './cs/deviceJob.json';
import w_deviceLink from './cs/deviceLink.json';
import w_deviceManage from './cs/deviceManage.json';
import w_deviceMove from './cs/deviceMove.json';
import w_devicePrinterErrors from './cs/devicePrinterErrors.json';
import w_deviceScreen from './cs/deviceScreen.json';
import w_deviceSend from './cs/deviceSend.json';
import w_deviceSlots from './cs/deviceSlots.json';
import w_deviceTimelapse from './cs/deviceTimelapse.json';
import w_devices from './cs/devices.json';
import w_engineSwitch from './cs/engineSwitch.json';
import w_filamentLimit from './cs/filamentLimit.json';
import w_filamentSync from './cs/filamentSync.json';
import w_flowVariant from './cs/flowVariant.json';
import w_flushVolumes from './cs/flushVolumes.json';
import w_fontList from './cs/fontList.json';
import w_gcodeErrors from './cs/gcodeErrors.json';
import w_gcodeFallback from './cs/gcodeFallback.json';
import w_groupMenu from './cs/groupMenu.json';
import w_importPresets from './cs/importPresets.json';
import w_language from './cs/language.json';
import w_layerCodes from './cs/layerCodes.json';
import w_layersPanel from './cs/layersPanel.json';
import w_linkProgram from './cs/linkProgram.json';
import w_loadingScreen from './cs/loadingScreen.json';
import w_measureFigures from './cs/measureFigures.json';
import w_objectList from './cs/objectList.json';
import w_objectMenu from './cs/objectMenu.json';
import w_objectSettings from './cs/objectSettings.json';
import w_open from './cs/open.json';
import w_openProject from './cs/openProject.json';
import w_optionCheck from './cs/optionCheck.json';
import w_optionField from './cs/optionField.json';
import w_paintTool from './cs/paintTool.json';
import w_pickReset from './cs/pickReset.json';
import w_plateIcons from './cs/plateIcons.json';
import w_plateMenu from './cs/plateMenu.json';
import w_plateSettings from './cs/plateSettings.json';
import w_presetChanges from './cs/presetChanges.json';
import w_presetEngines from './cs/presetEngines.json';
import w_presetFiles from './cs/presetFiles.json';
import w_presetMenu from './cs/presetMenu.json';
import w_presetSave from './cs/presetSave.json';
import w_presetSettings from './cs/presetSettings.json';
import w_previewColours from './cs/previewColours.json';
import w_previewTab from './cs/previewTab.json';
import w_printHistory from './cs/printHistory.json';
import w_projectImport from './cs/projectImport.json';
import w_projectMenu from './cs/projectMenu.json';
import w_projectStore from './cs/projectStore.json';
import w_saving from './cs/saving.json';
import w_settingPicker from './cs/settingPicker.json';
import w_settingsCheck from './cs/settingsCheck.json';
import w_settingsPanel from './cs/settingsPanel.json';
import w_settingsPrompt from './cs/settingsPrompt.json';
import w_setupWizard from './cs/setupWizard.json';
import w_shapePlacement from './cs/shapePlacement.json';
import w_shapes from './cs/shapes.json';
import w_sidebar from './cs/sidebar.json';
import w_simplifyFirst from './cs/simplifyFirst.json';
import w_simplifyTool from './cs/simplifyTool.json';
import w_slicerEdits from './cs/slicerEdits.json';
import w_slicerNotices from './cs/slicerNotices.json';
import w_svgTool from './cs/svgTool.json';
import w_tabs from './cs/tabs.json';
import w_textTool from './cs/textTool.json';
import w_theme from './cs/theme.json';
import w_time from './cs/time.json';
import w_timeFormat from './cs/timeFormat.json';
import w_toolPanel from './cs/toolPanel.json';
import w_toolbar from './cs/toolbar.json';
import w_topbar from './cs/topbar.json';
import w_uiParts from './cs/uiParts.json';
import w_viewControls from './cs/viewControls.json';
import w_viewport from './cs/viewport.json';
import w_volumes from './cs/volumes.json';

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
