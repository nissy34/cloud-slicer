// Polish, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in pl/ is missing here.
import w_account from './pl/account.json';
import w_accountErrors from './pl/accountErrors.json';
import w_actionbar from './pl/actionbar.json';
import w_adminPage from './pl/adminPage.json';
import w_aiApps from './pl/aiApps.json';
import w_arrangeOptions from './pl/arrangeOptions.json';
import w_askDialog from './pl/askDialog.json';
import w_assembleTool from './pl/assembleTool.json';
import w_backgroundSlice from './pl/backgroundSlice.json';
import w_booleanTool from './pl/booleanTool.json';
import w_brimEars from './pl/brimEars.json';
import w_calibration from './pl/calibration.json';
import w_chooseBar from './pl/chooseBar.json';
import w_clearance from './pl/clearance.json';
import w_colorMixing from './pl/colorMixing.json';
import w_colourPicker from './pl/colourPicker.json';
import w_common from './pl/common.json';
import w_continue from './pl/continue.json';
import w_convertDialog from './pl/convertDialog.json';
import w_cutTool from './pl/cutTool.json';
import w_deviceAddons from './pl/deviceAddons.json';
import w_deviceAlertText from './pl/deviceAlertText.json';
import w_deviceAlerts from './pl/deviceAlerts.json';
import w_deviceArrange from './pl/deviceArrange.json';
import w_deviceBrands from './pl/deviceBrands.json';
import w_deviceBridge from './pl/deviceBridge.json';
import w_deviceCamera from './pl/deviceCamera.json';
import w_deviceCards from './pl/deviceCards.json';
import w_deviceConsole from './pl/deviceConsole.json';
import w_deviceEditor from './pl/deviceEditor.json';
import w_deviceFiles from './pl/deviceFiles.json';
import w_deviceHeads from './pl/deviceHeads.json';
import w_deviceJob from './pl/deviceJob.json';
import w_deviceLink from './pl/deviceLink.json';
import w_deviceManage from './pl/deviceManage.json';
import w_deviceMove from './pl/deviceMove.json';
import w_devicePrinterErrors from './pl/devicePrinterErrors.json';
import w_deviceScreen from './pl/deviceScreen.json';
import w_deviceSend from './pl/deviceSend.json';
import w_deviceSlots from './pl/deviceSlots.json';
import w_deviceTimelapse from './pl/deviceTimelapse.json';
import w_devices from './pl/devices.json';
import w_engineSwitch from './pl/engineSwitch.json';
import w_filamentLimit from './pl/filamentLimit.json';
import w_filamentSync from './pl/filamentSync.json';
import w_flowVariant from './pl/flowVariant.json';
import w_flushVolumes from './pl/flushVolumes.json';
import w_fontList from './pl/fontList.json';
import w_gcodeErrors from './pl/gcodeErrors.json';
import w_gcodeFallback from './pl/gcodeFallback.json';
import w_groupMenu from './pl/groupMenu.json';
import w_importPresets from './pl/importPresets.json';
import w_language from './pl/language.json';
import w_layerCodes from './pl/layerCodes.json';
import w_layersPanel from './pl/layersPanel.json';
import w_linkProgram from './pl/linkProgram.json';
import w_loadingScreen from './pl/loadingScreen.json';
import w_measureFigures from './pl/measureFigures.json';
import w_objectList from './pl/objectList.json';
import w_objectMenu from './pl/objectMenu.json';
import w_objectSettings from './pl/objectSettings.json';
import w_open from './pl/open.json';
import w_openProject from './pl/openProject.json';
import w_optionCheck from './pl/optionCheck.json';
import w_optionField from './pl/optionField.json';
import w_paintTool from './pl/paintTool.json';
import w_pickReset from './pl/pickReset.json';
import w_plateIcons from './pl/plateIcons.json';
import w_plateMenu from './pl/plateMenu.json';
import w_plateSettings from './pl/plateSettings.json';
import w_presetChanges from './pl/presetChanges.json';
import w_presetEngines from './pl/presetEngines.json';
import w_presetFiles from './pl/presetFiles.json';
import w_presetMenu from './pl/presetMenu.json';
import w_presetSave from './pl/presetSave.json';
import w_presetSettings from './pl/presetSettings.json';
import w_previewColours from './pl/previewColours.json';
import w_previewTab from './pl/previewTab.json';
import w_printHistory from './pl/printHistory.json';
import w_projectImport from './pl/projectImport.json';
import w_projectMenu from './pl/projectMenu.json';
import w_projectStore from './pl/projectStore.json';
import w_saving from './pl/saving.json';
import w_settingPicker from './pl/settingPicker.json';
import w_settingsCheck from './pl/settingsCheck.json';
import w_settingsPanel from './pl/settingsPanel.json';
import w_settingsPrompt from './pl/settingsPrompt.json';
import w_setupWizard from './pl/setupWizard.json';
import w_shapePlacement from './pl/shapePlacement.json';
import w_shapes from './pl/shapes.json';
import w_sidebar from './pl/sidebar.json';
import w_simplifyFirst from './pl/simplifyFirst.json';
import w_simplifyTool from './pl/simplifyTool.json';
import w_slicerEdits from './pl/slicerEdits.json';
import w_slicerNotices from './pl/slicerNotices.json';
import w_svgTool from './pl/svgTool.json';
import w_tabs from './pl/tabs.json';
import w_textTool from './pl/textTool.json';
import w_theme from './pl/theme.json';
import w_time from './pl/time.json';
import w_timeFormat from './pl/timeFormat.json';
import w_toolPanel from './pl/toolPanel.json';
import w_toolbar from './pl/toolbar.json';
import w_topbar from './pl/topbar.json';
import w_uiParts from './pl/uiParts.json';
import w_viewControls from './pl/viewControls.json';
import w_viewport from './pl/viewport.json';
import w_volumes from './pl/volumes.json';

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
