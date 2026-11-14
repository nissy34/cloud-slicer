// French, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in fr/ is missing here.
import w_account from './fr/account.json';
import w_accountErrors from './fr/accountErrors.json';
import w_actionbar from './fr/actionbar.json';
import w_adminPage from './fr/adminPage.json';
import w_aiApps from './fr/aiApps.json';
import w_arrangeOptions from './fr/arrangeOptions.json';
import w_askDialog from './fr/askDialog.json';
import w_assembleTool from './fr/assembleTool.json';
import w_backgroundSlice from './fr/backgroundSlice.json';
import w_booleanTool from './fr/booleanTool.json';
import w_brimEars from './fr/brimEars.json';
import w_calibration from './fr/calibration.json';
import w_chooseBar from './fr/chooseBar.json';
import w_clearance from './fr/clearance.json';
import w_colorMixing from './fr/colorMixing.json';
import w_colourPicker from './fr/colourPicker.json';
import w_common from './fr/common.json';
import w_continue from './fr/continue.json';
import w_convertDialog from './fr/convertDialog.json';
import w_cutTool from './fr/cutTool.json';
import w_deviceAddons from './fr/deviceAddons.json';
import w_deviceAlertText from './fr/deviceAlertText.json';
import w_deviceAlerts from './fr/deviceAlerts.json';
import w_deviceArrange from './fr/deviceArrange.json';
import w_deviceBrands from './fr/deviceBrands.json';
import w_deviceBridge from './fr/deviceBridge.json';
import w_deviceCamera from './fr/deviceCamera.json';
import w_deviceCards from './fr/deviceCards.json';
import w_deviceConsole from './fr/deviceConsole.json';
import w_deviceEditor from './fr/deviceEditor.json';
import w_deviceFiles from './fr/deviceFiles.json';
import w_deviceHeads from './fr/deviceHeads.json';
import w_deviceJob from './fr/deviceJob.json';
import w_deviceLink from './fr/deviceLink.json';
import w_deviceManage from './fr/deviceManage.json';
import w_deviceMove from './fr/deviceMove.json';
import w_devicePrinterErrors from './fr/devicePrinterErrors.json';
import w_deviceScreen from './fr/deviceScreen.json';
import w_deviceSend from './fr/deviceSend.json';
import w_deviceSlots from './fr/deviceSlots.json';
import w_deviceTimelapse from './fr/deviceTimelapse.json';
import w_devices from './fr/devices.json';
import w_engineSwitch from './fr/engineSwitch.json';
import w_filamentLimit from './fr/filamentLimit.json';
import w_filamentSync from './fr/filamentSync.json';
import w_flowVariant from './fr/flowVariant.json';
import w_flushVolumes from './fr/flushVolumes.json';
import w_fontList from './fr/fontList.json';
import w_gcodeErrors from './fr/gcodeErrors.json';
import w_gcodeFallback from './fr/gcodeFallback.json';
import w_groupMenu from './fr/groupMenu.json';
import w_importPresets from './fr/importPresets.json';
import w_language from './fr/language.json';
import w_layerCodes from './fr/layerCodes.json';
import w_layersPanel from './fr/layersPanel.json';
import w_linkProgram from './fr/linkProgram.json';
import w_loadingScreen from './fr/loadingScreen.json';
import w_measureFigures from './fr/measureFigures.json';
import w_objectList from './fr/objectList.json';
import w_objectMenu from './fr/objectMenu.json';
import w_objectSettings from './fr/objectSettings.json';
import w_open from './fr/open.json';
import w_openProject from './fr/openProject.json';
import w_optionCheck from './fr/optionCheck.json';
import w_optionField from './fr/optionField.json';
import w_paintTool from './fr/paintTool.json';
import w_pickReset from './fr/pickReset.json';
import w_plateIcons from './fr/plateIcons.json';
import w_plateMenu from './fr/plateMenu.json';
import w_plateSettings from './fr/plateSettings.json';
import w_presetChanges from './fr/presetChanges.json';
import w_presetEngines from './fr/presetEngines.json';
import w_presetFiles from './fr/presetFiles.json';
import w_presetMenu from './fr/presetMenu.json';
import w_presetSave from './fr/presetSave.json';
import w_presetSettings from './fr/presetSettings.json';
import w_previewColours from './fr/previewColours.json';
import w_previewTab from './fr/previewTab.json';
import w_printHistory from './fr/printHistory.json';
import w_projectImport from './fr/projectImport.json';
import w_projectMenu from './fr/projectMenu.json';
import w_projectStore from './fr/projectStore.json';
import w_saving from './fr/saving.json';
import w_settingPicker from './fr/settingPicker.json';
import w_settingsCheck from './fr/settingsCheck.json';
import w_settingsPanel from './fr/settingsPanel.json';
import w_settingsPrompt from './fr/settingsPrompt.json';
import w_setupWizard from './fr/setupWizard.json';
import w_shapePlacement from './fr/shapePlacement.json';
import w_shapes from './fr/shapes.json';
import w_sidebar from './fr/sidebar.json';
import w_simplifyFirst from './fr/simplifyFirst.json';
import w_simplifyTool from './fr/simplifyTool.json';
import w_slicerEdits from './fr/slicerEdits.json';
import w_slicerNotices from './fr/slicerNotices.json';
import w_svgTool from './fr/svgTool.json';
import w_tabs from './fr/tabs.json';
import w_textTool from './fr/textTool.json';
import w_theme from './fr/theme.json';
import w_time from './fr/time.json';
import w_timeFormat from './fr/timeFormat.json';
import w_toolPanel from './fr/toolPanel.json';
import w_toolbar from './fr/toolbar.json';
import w_topbar from './fr/topbar.json';
import w_uiParts from './fr/uiParts.json';
import w_viewControls from './fr/viewControls.json';
import w_viewport from './fr/viewport.json';
import w_volumes from './fr/volumes.json';

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
