// German, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in de/ is missing here.
import w_account from './de/account.json';
import w_accountErrors from './de/accountErrors.json';
import w_actionbar from './de/actionbar.json';
import w_adminPage from './de/adminPage.json';
import w_aiApps from './de/aiApps.json';
import w_arrangeOptions from './de/arrangeOptions.json';
import w_askDialog from './de/askDialog.json';
import w_assembleTool from './de/assembleTool.json';
import w_backgroundSlice from './de/backgroundSlice.json';
import w_booleanTool from './de/booleanTool.json';
import w_brimEars from './de/brimEars.json';
import w_calibration from './de/calibration.json';
import w_chooseBar from './de/chooseBar.json';
import w_clearance from './de/clearance.json';
import w_colorMixing from './de/colorMixing.json';
import w_colourPicker from './de/colourPicker.json';
import w_common from './de/common.json';
import w_continue from './de/continue.json';
import w_convertDialog from './de/convertDialog.json';
import w_cutTool from './de/cutTool.json';
import w_deviceAddons from './de/deviceAddons.json';
import w_deviceAlertText from './de/deviceAlertText.json';
import w_deviceAlerts from './de/deviceAlerts.json';
import w_deviceArrange from './de/deviceArrange.json';
import w_deviceBrands from './de/deviceBrands.json';
import w_deviceBridge from './de/deviceBridge.json';
import w_deviceCamera from './de/deviceCamera.json';
import w_deviceCards from './de/deviceCards.json';
import w_deviceConsole from './de/deviceConsole.json';
import w_deviceEditor from './de/deviceEditor.json';
import w_deviceFiles from './de/deviceFiles.json';
import w_deviceHeads from './de/deviceHeads.json';
import w_deviceJob from './de/deviceJob.json';
import w_deviceLink from './de/deviceLink.json';
import w_deviceManage from './de/deviceManage.json';
import w_deviceMove from './de/deviceMove.json';
import w_devicePrinterErrors from './de/devicePrinterErrors.json';
import w_deviceScreen from './de/deviceScreen.json';
import w_deviceSend from './de/deviceSend.json';
import w_deviceSlots from './de/deviceSlots.json';
import w_deviceTimelapse from './de/deviceTimelapse.json';
import w_devices from './de/devices.json';
import w_engineSwitch from './de/engineSwitch.json';
import w_filamentLimit from './de/filamentLimit.json';
import w_filamentSync from './de/filamentSync.json';
import w_flowVariant from './de/flowVariant.json';
import w_flushVolumes from './de/flushVolumes.json';
import w_fontList from './de/fontList.json';
import w_gcodeErrors from './de/gcodeErrors.json';
import w_gcodeFallback from './de/gcodeFallback.json';
import w_groupMenu from './de/groupMenu.json';
import w_importPresets from './de/importPresets.json';
import w_language from './de/language.json';
import w_layerCodes from './de/layerCodes.json';
import w_layersPanel from './de/layersPanel.json';
import w_linkProgram from './de/linkProgram.json';
import w_loadingScreen from './de/loadingScreen.json';
import w_measureFigures from './de/measureFigures.json';
import w_objectList from './de/objectList.json';
import w_objectMenu from './de/objectMenu.json';
import w_objectSettings from './de/objectSettings.json';
import w_open from './de/open.json';
import w_openProject from './de/openProject.json';
import w_optionCheck from './de/optionCheck.json';
import w_optionField from './de/optionField.json';
import w_paintTool from './de/paintTool.json';
import w_pickReset from './de/pickReset.json';
import w_plateIcons from './de/plateIcons.json';
import w_plateMenu from './de/plateMenu.json';
import w_plateSettings from './de/plateSettings.json';
import w_presetChanges from './de/presetChanges.json';
import w_presetEngines from './de/presetEngines.json';
import w_presetFiles from './de/presetFiles.json';
import w_presetMenu from './de/presetMenu.json';
import w_presetSave from './de/presetSave.json';
import w_presetSettings from './de/presetSettings.json';
import w_previewColours from './de/previewColours.json';
import w_previewTab from './de/previewTab.json';
import w_printHistory from './de/printHistory.json';
import w_projectImport from './de/projectImport.json';
import w_projectMenu from './de/projectMenu.json';
import w_projectStore from './de/projectStore.json';
import w_saving from './de/saving.json';
import w_settingPicker from './de/settingPicker.json';
import w_settingsCheck from './de/settingsCheck.json';
import w_settingsPanel from './de/settingsPanel.json';
import w_settingsPrompt from './de/settingsPrompt.json';
import w_setupWizard from './de/setupWizard.json';
import w_shapePlacement from './de/shapePlacement.json';
import w_shapes from './de/shapes.json';
import w_sidebar from './de/sidebar.json';
import w_simplifyFirst from './de/simplifyFirst.json';
import w_simplifyTool from './de/simplifyTool.json';
import w_slicerEdits from './de/slicerEdits.json';
import w_slicerNotices from './de/slicerNotices.json';
import w_svgTool from './de/svgTool.json';
import w_tabs from './de/tabs.json';
import w_textTool from './de/textTool.json';
import w_theme from './de/theme.json';
import w_time from './de/time.json';
import w_timeFormat from './de/timeFormat.json';
import w_toolPanel from './de/toolPanel.json';
import w_toolbar from './de/toolbar.json';
import w_topbar from './de/topbar.json';
import w_uiParts from './de/uiParts.json';
import w_viewControls from './de/viewControls.json';
import w_viewport from './de/viewport.json';
import w_volumes from './de/volumes.json';

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
