// Thai, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in th/ is missing here.
import w_account from './th/account.json';
import w_accountErrors from './th/accountErrors.json';
import w_actionbar from './th/actionbar.json';
import w_adminPage from './th/adminPage.json';
import w_aiApps from './th/aiApps.json';
import w_arrangeOptions from './th/arrangeOptions.json';
import w_askDialog from './th/askDialog.json';
import w_assembleTool from './th/assembleTool.json';
import w_backgroundSlice from './th/backgroundSlice.json';
import w_booleanTool from './th/booleanTool.json';
import w_brimEars from './th/brimEars.json';
import w_calibration from './th/calibration.json';
import w_chooseBar from './th/chooseBar.json';
import w_clearance from './th/clearance.json';
import w_colorMixing from './th/colorMixing.json';
import w_colourPicker from './th/colourPicker.json';
import w_common from './th/common.json';
import w_continue from './th/continue.json';
import w_convertDialog from './th/convertDialog.json';
import w_cutTool from './th/cutTool.json';
import w_deviceAddons from './th/deviceAddons.json';
import w_deviceAlertText from './th/deviceAlertText.json';
import w_deviceAlerts from './th/deviceAlerts.json';
import w_deviceArrange from './th/deviceArrange.json';
import w_deviceBrands from './th/deviceBrands.json';
import w_deviceBridge from './th/deviceBridge.json';
import w_deviceCamera from './th/deviceCamera.json';
import w_deviceCards from './th/deviceCards.json';
import w_deviceConsole from './th/deviceConsole.json';
import w_deviceEditor from './th/deviceEditor.json';
import w_deviceFiles from './th/deviceFiles.json';
import w_deviceHeads from './th/deviceHeads.json';
import w_deviceJob from './th/deviceJob.json';
import w_deviceLink from './th/deviceLink.json';
import w_deviceManage from './th/deviceManage.json';
import w_deviceMove from './th/deviceMove.json';
import w_devicePrinterErrors from './th/devicePrinterErrors.json';
import w_deviceScreen from './th/deviceScreen.json';
import w_deviceSend from './th/deviceSend.json';
import w_deviceSlots from './th/deviceSlots.json';
import w_deviceTimelapse from './th/deviceTimelapse.json';
import w_devices from './th/devices.json';
import w_engineSwitch from './th/engineSwitch.json';
import w_filamentLimit from './th/filamentLimit.json';
import w_filamentSync from './th/filamentSync.json';
import w_flowVariant from './th/flowVariant.json';
import w_flushVolumes from './th/flushVolumes.json';
import w_fontList from './th/fontList.json';
import w_gcodeErrors from './th/gcodeErrors.json';
import w_gcodeFallback from './th/gcodeFallback.json';
import w_groupMenu from './th/groupMenu.json';
import w_importPresets from './th/importPresets.json';
import w_language from './th/language.json';
import w_layerCodes from './th/layerCodes.json';
import w_layersPanel from './th/layersPanel.json';
import w_linkProgram from './th/linkProgram.json';
import w_loadingScreen from './th/loadingScreen.json';
import w_measureFigures from './th/measureFigures.json';
import w_objectList from './th/objectList.json';
import w_objectMenu from './th/objectMenu.json';
import w_objectSettings from './th/objectSettings.json';
import w_open from './th/open.json';
import w_openProject from './th/openProject.json';
import w_optionCheck from './th/optionCheck.json';
import w_optionField from './th/optionField.json';
import w_paintTool from './th/paintTool.json';
import w_pickReset from './th/pickReset.json';
import w_plateIcons from './th/plateIcons.json';
import w_plateMenu from './th/plateMenu.json';
import w_plateSettings from './th/plateSettings.json';
import w_presetChanges from './th/presetChanges.json';
import w_presetEngines from './th/presetEngines.json';
import w_presetFiles from './th/presetFiles.json';
import w_presetMenu from './th/presetMenu.json';
import w_presetSave from './th/presetSave.json';
import w_presetSettings from './th/presetSettings.json';
import w_previewColours from './th/previewColours.json';
import w_previewTab from './th/previewTab.json';
import w_printHistory from './th/printHistory.json';
import w_projectImport from './th/projectImport.json';
import w_projectMenu from './th/projectMenu.json';
import w_projectStore from './th/projectStore.json';
import w_saving from './th/saving.json';
import w_settingPicker from './th/settingPicker.json';
import w_settingsCheck from './th/settingsCheck.json';
import w_settingsPanel from './th/settingsPanel.json';
import w_settingsPrompt from './th/settingsPrompt.json';
import w_setupWizard from './th/setupWizard.json';
import w_shapePlacement from './th/shapePlacement.json';
import w_shapes from './th/shapes.json';
import w_sidebar from './th/sidebar.json';
import w_simplifyFirst from './th/simplifyFirst.json';
import w_simplifyTool from './th/simplifyTool.json';
import w_slicerEdits from './th/slicerEdits.json';
import w_slicerNotices from './th/slicerNotices.json';
import w_svgTool from './th/svgTool.json';
import w_tabs from './th/tabs.json';
import w_textTool from './th/textTool.json';
import w_theme from './th/theme.json';
import w_time from './th/time.json';
import w_timeFormat from './th/timeFormat.json';
import w_toolPanel from './th/toolPanel.json';
import w_toolbar from './th/toolbar.json';
import w_topbar from './th/topbar.json';
import w_uiParts from './th/uiParts.json';
import w_viewControls from './th/viewControls.json';
import w_viewport from './th/viewport.json';
import w_volumes from './th/volumes.json';

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
