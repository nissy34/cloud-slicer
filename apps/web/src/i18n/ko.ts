// Korean, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in ko/ is missing here.
import w_account from './ko/account.json';
import w_accountErrors from './ko/accountErrors.json';
import w_actionbar from './ko/actionbar.json';
import w_adminPage from './ko/adminPage.json';
import w_aiApps from './ko/aiApps.json';
import w_arrangeOptions from './ko/arrangeOptions.json';
import w_askDialog from './ko/askDialog.json';
import w_assembleTool from './ko/assembleTool.json';
import w_backgroundSlice from './ko/backgroundSlice.json';
import w_booleanTool from './ko/booleanTool.json';
import w_brimEars from './ko/brimEars.json';
import w_calibration from './ko/calibration.json';
import w_chooseBar from './ko/chooseBar.json';
import w_clearance from './ko/clearance.json';
import w_colorMixing from './ko/colorMixing.json';
import w_colourPicker from './ko/colourPicker.json';
import w_common from './ko/common.json';
import w_continue from './ko/continue.json';
import w_convertDialog from './ko/convertDialog.json';
import w_cutTool from './ko/cutTool.json';
import w_deviceAddons from './ko/deviceAddons.json';
import w_deviceAlertText from './ko/deviceAlertText.json';
import w_deviceAlerts from './ko/deviceAlerts.json';
import w_deviceArrange from './ko/deviceArrange.json';
import w_deviceBrands from './ko/deviceBrands.json';
import w_deviceBridge from './ko/deviceBridge.json';
import w_deviceCamera from './ko/deviceCamera.json';
import w_deviceCards from './ko/deviceCards.json';
import w_deviceConsole from './ko/deviceConsole.json';
import w_deviceEditor from './ko/deviceEditor.json';
import w_deviceFiles from './ko/deviceFiles.json';
import w_deviceHeads from './ko/deviceHeads.json';
import w_deviceJob from './ko/deviceJob.json';
import w_deviceLink from './ko/deviceLink.json';
import w_deviceManage from './ko/deviceManage.json';
import w_deviceMove from './ko/deviceMove.json';
import w_devicePrinterErrors from './ko/devicePrinterErrors.json';
import w_deviceScreen from './ko/deviceScreen.json';
import w_deviceSend from './ko/deviceSend.json';
import w_deviceSlots from './ko/deviceSlots.json';
import w_deviceTimelapse from './ko/deviceTimelapse.json';
import w_devices from './ko/devices.json';
import w_engineSwitch from './ko/engineSwitch.json';
import w_filamentLimit from './ko/filamentLimit.json';
import w_filamentSync from './ko/filamentSync.json';
import w_flowVariant from './ko/flowVariant.json';
import w_flushVolumes from './ko/flushVolumes.json';
import w_fontList from './ko/fontList.json';
import w_gcodeErrors from './ko/gcodeErrors.json';
import w_gcodeFallback from './ko/gcodeFallback.json';
import w_groupMenu from './ko/groupMenu.json';
import w_importPresets from './ko/importPresets.json';
import w_language from './ko/language.json';
import w_layerCodes from './ko/layerCodes.json';
import w_layersPanel from './ko/layersPanel.json';
import w_linkProgram from './ko/linkProgram.json';
import w_loadingScreen from './ko/loadingScreen.json';
import w_measureFigures from './ko/measureFigures.json';
import w_objectList from './ko/objectList.json';
import w_objectMenu from './ko/objectMenu.json';
import w_objectSettings from './ko/objectSettings.json';
import w_open from './ko/open.json';
import w_openProject from './ko/openProject.json';
import w_optionCheck from './ko/optionCheck.json';
import w_optionField from './ko/optionField.json';
import w_paintTool from './ko/paintTool.json';
import w_pickReset from './ko/pickReset.json';
import w_plateIcons from './ko/plateIcons.json';
import w_plateMenu from './ko/plateMenu.json';
import w_plateSettings from './ko/plateSettings.json';
import w_presetChanges from './ko/presetChanges.json';
import w_presetEngines from './ko/presetEngines.json';
import w_presetFiles from './ko/presetFiles.json';
import w_presetMenu from './ko/presetMenu.json';
import w_presetSave from './ko/presetSave.json';
import w_presetSettings from './ko/presetSettings.json';
import w_previewColours from './ko/previewColours.json';
import w_previewTab from './ko/previewTab.json';
import w_printHistory from './ko/printHistory.json';
import w_projectImport from './ko/projectImport.json';
import w_projectMenu from './ko/projectMenu.json';
import w_projectStore from './ko/projectStore.json';
import w_saving from './ko/saving.json';
import w_settingPicker from './ko/settingPicker.json';
import w_settingsCheck from './ko/settingsCheck.json';
import w_settingsPanel from './ko/settingsPanel.json';
import w_settingsPrompt from './ko/settingsPrompt.json';
import w_setupWizard from './ko/setupWizard.json';
import w_shapePlacement from './ko/shapePlacement.json';
import w_shapes from './ko/shapes.json';
import w_sidebar from './ko/sidebar.json';
import w_simplifyFirst from './ko/simplifyFirst.json';
import w_simplifyTool from './ko/simplifyTool.json';
import w_slicerEdits from './ko/slicerEdits.json';
import w_slicerNotices from './ko/slicerNotices.json';
import w_svgTool from './ko/svgTool.json';
import w_tabs from './ko/tabs.json';
import w_textTool from './ko/textTool.json';
import w_theme from './ko/theme.json';
import w_time from './ko/time.json';
import w_timeFormat from './ko/timeFormat.json';
import w_toolPanel from './ko/toolPanel.json';
import w_toolbar from './ko/toolbar.json';
import w_topbar from './ko/topbar.json';
import w_uiParts from './ko/uiParts.json';
import w_viewControls from './ko/viewControls.json';
import w_viewport from './ko/viewport.json';
import w_volumes from './ko/volumes.json';

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
