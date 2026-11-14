// Swedish, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in sv/ is missing here.
import w_account from './sv/account.json';
import w_accountErrors from './sv/accountErrors.json';
import w_actionbar from './sv/actionbar.json';
import w_adminPage from './sv/adminPage.json';
import w_aiApps from './sv/aiApps.json';
import w_arrangeOptions from './sv/arrangeOptions.json';
import w_askDialog from './sv/askDialog.json';
import w_assembleTool from './sv/assembleTool.json';
import w_backgroundSlice from './sv/backgroundSlice.json';
import w_booleanTool from './sv/booleanTool.json';
import w_brimEars from './sv/brimEars.json';
import w_calibration from './sv/calibration.json';
import w_chooseBar from './sv/chooseBar.json';
import w_clearance from './sv/clearance.json';
import w_colorMixing from './sv/colorMixing.json';
import w_colourPicker from './sv/colourPicker.json';
import w_common from './sv/common.json';
import w_continue from './sv/continue.json';
import w_convertDialog from './sv/convertDialog.json';
import w_cutTool from './sv/cutTool.json';
import w_deviceAddons from './sv/deviceAddons.json';
import w_deviceAlertText from './sv/deviceAlertText.json';
import w_deviceAlerts from './sv/deviceAlerts.json';
import w_deviceArrange from './sv/deviceArrange.json';
import w_deviceBrands from './sv/deviceBrands.json';
import w_deviceBridge from './sv/deviceBridge.json';
import w_deviceCamera from './sv/deviceCamera.json';
import w_deviceCards from './sv/deviceCards.json';
import w_deviceConsole from './sv/deviceConsole.json';
import w_deviceEditor from './sv/deviceEditor.json';
import w_deviceFiles from './sv/deviceFiles.json';
import w_deviceHeads from './sv/deviceHeads.json';
import w_deviceJob from './sv/deviceJob.json';
import w_deviceLink from './sv/deviceLink.json';
import w_deviceManage from './sv/deviceManage.json';
import w_deviceMove from './sv/deviceMove.json';
import w_devicePrinterErrors from './sv/devicePrinterErrors.json';
import w_deviceScreen from './sv/deviceScreen.json';
import w_deviceSend from './sv/deviceSend.json';
import w_deviceSlots from './sv/deviceSlots.json';
import w_deviceTimelapse from './sv/deviceTimelapse.json';
import w_devices from './sv/devices.json';
import w_engineSwitch from './sv/engineSwitch.json';
import w_filamentLimit from './sv/filamentLimit.json';
import w_filamentSync from './sv/filamentSync.json';
import w_flowVariant from './sv/flowVariant.json';
import w_flushVolumes from './sv/flushVolumes.json';
import w_fontList from './sv/fontList.json';
import w_gcodeErrors from './sv/gcodeErrors.json';
import w_gcodeFallback from './sv/gcodeFallback.json';
import w_groupMenu from './sv/groupMenu.json';
import w_importPresets from './sv/importPresets.json';
import w_language from './sv/language.json';
import w_layerCodes from './sv/layerCodes.json';
import w_layersPanel from './sv/layersPanel.json';
import w_linkProgram from './sv/linkProgram.json';
import w_loadingScreen from './sv/loadingScreen.json';
import w_measureFigures from './sv/measureFigures.json';
import w_objectList from './sv/objectList.json';
import w_objectMenu from './sv/objectMenu.json';
import w_objectSettings from './sv/objectSettings.json';
import w_open from './sv/open.json';
import w_openProject from './sv/openProject.json';
import w_optionCheck from './sv/optionCheck.json';
import w_optionField from './sv/optionField.json';
import w_paintTool from './sv/paintTool.json';
import w_pickReset from './sv/pickReset.json';
import w_plateIcons from './sv/plateIcons.json';
import w_plateMenu from './sv/plateMenu.json';
import w_plateSettings from './sv/plateSettings.json';
import w_presetChanges from './sv/presetChanges.json';
import w_presetEngines from './sv/presetEngines.json';
import w_presetFiles from './sv/presetFiles.json';
import w_presetMenu from './sv/presetMenu.json';
import w_presetSave from './sv/presetSave.json';
import w_presetSettings from './sv/presetSettings.json';
import w_previewColours from './sv/previewColours.json';
import w_previewTab from './sv/previewTab.json';
import w_printHistory from './sv/printHistory.json';
import w_projectImport from './sv/projectImport.json';
import w_projectMenu from './sv/projectMenu.json';
import w_projectStore from './sv/projectStore.json';
import w_saving from './sv/saving.json';
import w_settingPicker from './sv/settingPicker.json';
import w_settingsCheck from './sv/settingsCheck.json';
import w_settingsPanel from './sv/settingsPanel.json';
import w_settingsPrompt from './sv/settingsPrompt.json';
import w_setupWizard from './sv/setupWizard.json';
import w_shapePlacement from './sv/shapePlacement.json';
import w_shapes from './sv/shapes.json';
import w_sidebar from './sv/sidebar.json';
import w_simplifyFirst from './sv/simplifyFirst.json';
import w_simplifyTool from './sv/simplifyTool.json';
import w_slicerEdits from './sv/slicerEdits.json';
import w_slicerNotices from './sv/slicerNotices.json';
import w_svgTool from './sv/svgTool.json';
import w_tabs from './sv/tabs.json';
import w_textTool from './sv/textTool.json';
import w_theme from './sv/theme.json';
import w_time from './sv/time.json';
import w_timeFormat from './sv/timeFormat.json';
import w_toolPanel from './sv/toolPanel.json';
import w_toolbar from './sv/toolbar.json';
import w_topbar from './sv/topbar.json';
import w_uiParts from './sv/uiParts.json';
import w_viewControls from './sv/viewControls.json';
import w_viewport from './sv/viewport.json';
import w_volumes from './sv/volumes.json';

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
