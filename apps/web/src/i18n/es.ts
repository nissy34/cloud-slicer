// Spanish, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in es/ is missing here.
import w_account from './es/account.json';
import w_accountErrors from './es/accountErrors.json';
import w_actionbar from './es/actionbar.json';
import w_adminPage from './es/adminPage.json';
import w_aiApps from './es/aiApps.json';
import w_arrangeOptions from './es/arrangeOptions.json';
import w_askDialog from './es/askDialog.json';
import w_assembleTool from './es/assembleTool.json';
import w_backgroundSlice from './es/backgroundSlice.json';
import w_booleanTool from './es/booleanTool.json';
import w_brimEars from './es/brimEars.json';
import w_calibration from './es/calibration.json';
import w_chooseBar from './es/chooseBar.json';
import w_clearance from './es/clearance.json';
import w_colorMixing from './es/colorMixing.json';
import w_colourPicker from './es/colourPicker.json';
import w_common from './es/common.json';
import w_continue from './es/continue.json';
import w_convertDialog from './es/convertDialog.json';
import w_cutTool from './es/cutTool.json';
import w_deviceAddons from './es/deviceAddons.json';
import w_deviceAlertText from './es/deviceAlertText.json';
import w_deviceAlerts from './es/deviceAlerts.json';
import w_deviceArrange from './es/deviceArrange.json';
import w_deviceBrands from './es/deviceBrands.json';
import w_deviceBridge from './es/deviceBridge.json';
import w_deviceCamera from './es/deviceCamera.json';
import w_deviceCards from './es/deviceCards.json';
import w_deviceConsole from './es/deviceConsole.json';
import w_deviceEditor from './es/deviceEditor.json';
import w_deviceFiles from './es/deviceFiles.json';
import w_deviceHeads from './es/deviceHeads.json';
import w_deviceJob from './es/deviceJob.json';
import w_deviceLink from './es/deviceLink.json';
import w_deviceManage from './es/deviceManage.json';
import w_deviceMove from './es/deviceMove.json';
import w_devicePrinterErrors from './es/devicePrinterErrors.json';
import w_deviceScreen from './es/deviceScreen.json';
import w_deviceSend from './es/deviceSend.json';
import w_deviceSlots from './es/deviceSlots.json';
import w_deviceTimelapse from './es/deviceTimelapse.json';
import w_devices from './es/devices.json';
import w_engineSwitch from './es/engineSwitch.json';
import w_filamentLimit from './es/filamentLimit.json';
import w_filamentSync from './es/filamentSync.json';
import w_flowVariant from './es/flowVariant.json';
import w_flushVolumes from './es/flushVolumes.json';
import w_fontList from './es/fontList.json';
import w_gcodeErrors from './es/gcodeErrors.json';
import w_gcodeFallback from './es/gcodeFallback.json';
import w_groupMenu from './es/groupMenu.json';
import w_importPresets from './es/importPresets.json';
import w_language from './es/language.json';
import w_layerCodes from './es/layerCodes.json';
import w_layersPanel from './es/layersPanel.json';
import w_linkProgram from './es/linkProgram.json';
import w_loadingScreen from './es/loadingScreen.json';
import w_measureFigures from './es/measureFigures.json';
import w_objectList from './es/objectList.json';
import w_objectMenu from './es/objectMenu.json';
import w_objectSettings from './es/objectSettings.json';
import w_open from './es/open.json';
import w_openProject from './es/openProject.json';
import w_optionCheck from './es/optionCheck.json';
import w_optionField from './es/optionField.json';
import w_paintTool from './es/paintTool.json';
import w_pickReset from './es/pickReset.json';
import w_plateIcons from './es/plateIcons.json';
import w_plateMenu from './es/plateMenu.json';
import w_plateSettings from './es/plateSettings.json';
import w_presetChanges from './es/presetChanges.json';
import w_presetEngines from './es/presetEngines.json';
import w_presetFiles from './es/presetFiles.json';
import w_presetMenu from './es/presetMenu.json';
import w_presetSave from './es/presetSave.json';
import w_presetSettings from './es/presetSettings.json';
import w_previewColours from './es/previewColours.json';
import w_previewTab from './es/previewTab.json';
import w_printHistory from './es/printHistory.json';
import w_projectImport from './es/projectImport.json';
import w_projectMenu from './es/projectMenu.json';
import w_projectStore from './es/projectStore.json';
import w_saving from './es/saving.json';
import w_settingPicker from './es/settingPicker.json';
import w_settingsCheck from './es/settingsCheck.json';
import w_settingsPanel from './es/settingsPanel.json';
import w_settingsPrompt from './es/settingsPrompt.json';
import w_setupWizard from './es/setupWizard.json';
import w_shapePlacement from './es/shapePlacement.json';
import w_shapes from './es/shapes.json';
import w_sidebar from './es/sidebar.json';
import w_simplifyFirst from './es/simplifyFirst.json';
import w_simplifyTool from './es/simplifyTool.json';
import w_slicerEdits from './es/slicerEdits.json';
import w_slicerNotices from './es/slicerNotices.json';
import w_svgTool from './es/svgTool.json';
import w_tabs from './es/tabs.json';
import w_textTool from './es/textTool.json';
import w_theme from './es/theme.json';
import w_time from './es/time.json';
import w_timeFormat from './es/timeFormat.json';
import w_toolPanel from './es/toolPanel.json';
import w_toolbar from './es/toolbar.json';
import w_topbar from './es/topbar.json';
import w_uiParts from './es/uiParts.json';
import w_viewControls from './es/viewControls.json';
import w_viewport from './es/viewport.json';
import w_volumes from './es/volumes.json';

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
