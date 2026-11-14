// Hungarian, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in hu/ is missing here.
import w_account from './hu/account.json';
import w_accountErrors from './hu/accountErrors.json';
import w_actionbar from './hu/actionbar.json';
import w_adminPage from './hu/adminPage.json';
import w_aiApps from './hu/aiApps.json';
import w_arrangeOptions from './hu/arrangeOptions.json';
import w_askDialog from './hu/askDialog.json';
import w_assembleTool from './hu/assembleTool.json';
import w_backgroundSlice from './hu/backgroundSlice.json';
import w_booleanTool from './hu/booleanTool.json';
import w_brimEars from './hu/brimEars.json';
import w_calibration from './hu/calibration.json';
import w_chooseBar from './hu/chooseBar.json';
import w_clearance from './hu/clearance.json';
import w_colorMixing from './hu/colorMixing.json';
import w_colourPicker from './hu/colourPicker.json';
import w_common from './hu/common.json';
import w_continue from './hu/continue.json';
import w_convertDialog from './hu/convertDialog.json';
import w_cutTool from './hu/cutTool.json';
import w_deviceAddons from './hu/deviceAddons.json';
import w_deviceAlertText from './hu/deviceAlertText.json';
import w_deviceAlerts from './hu/deviceAlerts.json';
import w_deviceArrange from './hu/deviceArrange.json';
import w_deviceBrands from './hu/deviceBrands.json';
import w_deviceBridge from './hu/deviceBridge.json';
import w_deviceCamera from './hu/deviceCamera.json';
import w_deviceCards from './hu/deviceCards.json';
import w_deviceConsole from './hu/deviceConsole.json';
import w_deviceEditor from './hu/deviceEditor.json';
import w_deviceFiles from './hu/deviceFiles.json';
import w_deviceHeads from './hu/deviceHeads.json';
import w_deviceJob from './hu/deviceJob.json';
import w_deviceLink from './hu/deviceLink.json';
import w_deviceManage from './hu/deviceManage.json';
import w_deviceMove from './hu/deviceMove.json';
import w_devicePrinterErrors from './hu/devicePrinterErrors.json';
import w_deviceScreen from './hu/deviceScreen.json';
import w_deviceSend from './hu/deviceSend.json';
import w_deviceSlots from './hu/deviceSlots.json';
import w_deviceTimelapse from './hu/deviceTimelapse.json';
import w_devices from './hu/devices.json';
import w_engineSwitch from './hu/engineSwitch.json';
import w_filamentLimit from './hu/filamentLimit.json';
import w_filamentSync from './hu/filamentSync.json';
import w_flowVariant from './hu/flowVariant.json';
import w_flushVolumes from './hu/flushVolumes.json';
import w_fontList from './hu/fontList.json';
import w_gcodeErrors from './hu/gcodeErrors.json';
import w_gcodeFallback from './hu/gcodeFallback.json';
import w_groupMenu from './hu/groupMenu.json';
import w_importPresets from './hu/importPresets.json';
import w_language from './hu/language.json';
import w_layerCodes from './hu/layerCodes.json';
import w_layersPanel from './hu/layersPanel.json';
import w_linkProgram from './hu/linkProgram.json';
import w_loadingScreen from './hu/loadingScreen.json';
import w_measureFigures from './hu/measureFigures.json';
import w_objectList from './hu/objectList.json';
import w_objectMenu from './hu/objectMenu.json';
import w_objectSettings from './hu/objectSettings.json';
import w_open from './hu/open.json';
import w_openProject from './hu/openProject.json';
import w_optionCheck from './hu/optionCheck.json';
import w_optionField from './hu/optionField.json';
import w_paintTool from './hu/paintTool.json';
import w_pickReset from './hu/pickReset.json';
import w_plateIcons from './hu/plateIcons.json';
import w_plateMenu from './hu/plateMenu.json';
import w_plateSettings from './hu/plateSettings.json';
import w_presetChanges from './hu/presetChanges.json';
import w_presetEngines from './hu/presetEngines.json';
import w_presetFiles from './hu/presetFiles.json';
import w_presetMenu from './hu/presetMenu.json';
import w_presetSave from './hu/presetSave.json';
import w_presetSettings from './hu/presetSettings.json';
import w_previewColours from './hu/previewColours.json';
import w_previewTab from './hu/previewTab.json';
import w_printHistory from './hu/printHistory.json';
import w_projectImport from './hu/projectImport.json';
import w_projectMenu from './hu/projectMenu.json';
import w_projectStore from './hu/projectStore.json';
import w_saving from './hu/saving.json';
import w_settingPicker from './hu/settingPicker.json';
import w_settingsCheck from './hu/settingsCheck.json';
import w_settingsPanel from './hu/settingsPanel.json';
import w_settingsPrompt from './hu/settingsPrompt.json';
import w_setupWizard from './hu/setupWizard.json';
import w_shapePlacement from './hu/shapePlacement.json';
import w_shapes from './hu/shapes.json';
import w_sidebar from './hu/sidebar.json';
import w_simplifyFirst from './hu/simplifyFirst.json';
import w_simplifyTool from './hu/simplifyTool.json';
import w_slicerEdits from './hu/slicerEdits.json';
import w_slicerNotices from './hu/slicerNotices.json';
import w_svgTool from './hu/svgTool.json';
import w_tabs from './hu/tabs.json';
import w_textTool from './hu/textTool.json';
import w_theme from './hu/theme.json';
import w_time from './hu/time.json';
import w_timeFormat from './hu/timeFormat.json';
import w_toolPanel from './hu/toolPanel.json';
import w_toolbar from './hu/toolbar.json';
import w_topbar from './hu/topbar.json';
import w_uiParts from './hu/uiParts.json';
import w_viewControls from './hu/viewControls.json';
import w_viewport from './hu/viewport.json';
import w_volumes from './hu/volumes.json';

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
