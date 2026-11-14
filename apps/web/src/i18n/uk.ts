// Ukrainian, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in uk/ is missing here.
import w_account from './uk/account.json';
import w_accountErrors from './uk/accountErrors.json';
import w_actionbar from './uk/actionbar.json';
import w_adminPage from './uk/adminPage.json';
import w_aiApps from './uk/aiApps.json';
import w_arrangeOptions from './uk/arrangeOptions.json';
import w_askDialog from './uk/askDialog.json';
import w_assembleTool from './uk/assembleTool.json';
import w_backgroundSlice from './uk/backgroundSlice.json';
import w_booleanTool from './uk/booleanTool.json';
import w_brimEars from './uk/brimEars.json';
import w_calibration from './uk/calibration.json';
import w_chooseBar from './uk/chooseBar.json';
import w_clearance from './uk/clearance.json';
import w_colorMixing from './uk/colorMixing.json';
import w_colourPicker from './uk/colourPicker.json';
import w_common from './uk/common.json';
import w_continue from './uk/continue.json';
import w_convertDialog from './uk/convertDialog.json';
import w_cutTool from './uk/cutTool.json';
import w_deviceAddons from './uk/deviceAddons.json';
import w_deviceAlertText from './uk/deviceAlertText.json';
import w_deviceAlerts from './uk/deviceAlerts.json';
import w_deviceArrange from './uk/deviceArrange.json';
import w_deviceBrands from './uk/deviceBrands.json';
import w_deviceBridge from './uk/deviceBridge.json';
import w_deviceCamera from './uk/deviceCamera.json';
import w_deviceCards from './uk/deviceCards.json';
import w_deviceConsole from './uk/deviceConsole.json';
import w_deviceEditor from './uk/deviceEditor.json';
import w_deviceFiles from './uk/deviceFiles.json';
import w_deviceHeads from './uk/deviceHeads.json';
import w_deviceJob from './uk/deviceJob.json';
import w_deviceLink from './uk/deviceLink.json';
import w_deviceManage from './uk/deviceManage.json';
import w_deviceMove from './uk/deviceMove.json';
import w_devicePrinterErrors from './uk/devicePrinterErrors.json';
import w_deviceScreen from './uk/deviceScreen.json';
import w_deviceSend from './uk/deviceSend.json';
import w_deviceSlots from './uk/deviceSlots.json';
import w_deviceTimelapse from './uk/deviceTimelapse.json';
import w_devices from './uk/devices.json';
import w_engineSwitch from './uk/engineSwitch.json';
import w_filamentLimit from './uk/filamentLimit.json';
import w_filamentSync from './uk/filamentSync.json';
import w_flowVariant from './uk/flowVariant.json';
import w_flushVolumes from './uk/flushVolumes.json';
import w_fontList from './uk/fontList.json';
import w_gcodeErrors from './uk/gcodeErrors.json';
import w_gcodeFallback from './uk/gcodeFallback.json';
import w_groupMenu from './uk/groupMenu.json';
import w_importPresets from './uk/importPresets.json';
import w_language from './uk/language.json';
import w_layerCodes from './uk/layerCodes.json';
import w_layersPanel from './uk/layersPanel.json';
import w_linkProgram from './uk/linkProgram.json';
import w_loadingScreen from './uk/loadingScreen.json';
import w_measureFigures from './uk/measureFigures.json';
import w_objectList from './uk/objectList.json';
import w_objectMenu from './uk/objectMenu.json';
import w_objectSettings from './uk/objectSettings.json';
import w_open from './uk/open.json';
import w_openProject from './uk/openProject.json';
import w_optionCheck from './uk/optionCheck.json';
import w_optionField from './uk/optionField.json';
import w_paintTool from './uk/paintTool.json';
import w_pickReset from './uk/pickReset.json';
import w_plateIcons from './uk/plateIcons.json';
import w_plateMenu from './uk/plateMenu.json';
import w_plateSettings from './uk/plateSettings.json';
import w_presetChanges from './uk/presetChanges.json';
import w_presetEngines from './uk/presetEngines.json';
import w_presetFiles from './uk/presetFiles.json';
import w_presetMenu from './uk/presetMenu.json';
import w_presetSave from './uk/presetSave.json';
import w_presetSettings from './uk/presetSettings.json';
import w_previewColours from './uk/previewColours.json';
import w_previewTab from './uk/previewTab.json';
import w_printHistory from './uk/printHistory.json';
import w_projectImport from './uk/projectImport.json';
import w_projectMenu from './uk/projectMenu.json';
import w_projectStore from './uk/projectStore.json';
import w_saving from './uk/saving.json';
import w_settingPicker from './uk/settingPicker.json';
import w_settingsCheck from './uk/settingsCheck.json';
import w_settingsPanel from './uk/settingsPanel.json';
import w_settingsPrompt from './uk/settingsPrompt.json';
import w_setupWizard from './uk/setupWizard.json';
import w_shapePlacement from './uk/shapePlacement.json';
import w_shapes from './uk/shapes.json';
import w_sidebar from './uk/sidebar.json';
import w_simplifyFirst from './uk/simplifyFirst.json';
import w_simplifyTool from './uk/simplifyTool.json';
import w_slicerEdits from './uk/slicerEdits.json';
import w_slicerNotices from './uk/slicerNotices.json';
import w_svgTool from './uk/svgTool.json';
import w_tabs from './uk/tabs.json';
import w_textTool from './uk/textTool.json';
import w_theme from './uk/theme.json';
import w_time from './uk/time.json';
import w_timeFormat from './uk/timeFormat.json';
import w_toolPanel from './uk/toolPanel.json';
import w_toolbar from './uk/toolbar.json';
import w_topbar from './uk/topbar.json';
import w_uiParts from './uk/uiParts.json';
import w_viewControls from './uk/viewControls.json';
import w_viewport from './uk/viewport.json';
import w_volumes from './uk/volumes.json';

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
