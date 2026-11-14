// Lithuanian, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in lt/ is missing here.
import w_account from './lt/account.json';
import w_accountErrors from './lt/accountErrors.json';
import w_actionbar from './lt/actionbar.json';
import w_adminPage from './lt/adminPage.json';
import w_aiApps from './lt/aiApps.json';
import w_arrangeOptions from './lt/arrangeOptions.json';
import w_askDialog from './lt/askDialog.json';
import w_assembleTool from './lt/assembleTool.json';
import w_backgroundSlice from './lt/backgroundSlice.json';
import w_booleanTool from './lt/booleanTool.json';
import w_brimEars from './lt/brimEars.json';
import w_calibration from './lt/calibration.json';
import w_chooseBar from './lt/chooseBar.json';
import w_clearance from './lt/clearance.json';
import w_colorMixing from './lt/colorMixing.json';
import w_colourPicker from './lt/colourPicker.json';
import w_common from './lt/common.json';
import w_continue from './lt/continue.json';
import w_convertDialog from './lt/convertDialog.json';
import w_cutTool from './lt/cutTool.json';
import w_deviceAddons from './lt/deviceAddons.json';
import w_deviceAlertText from './lt/deviceAlertText.json';
import w_deviceAlerts from './lt/deviceAlerts.json';
import w_deviceArrange from './lt/deviceArrange.json';
import w_deviceBrands from './lt/deviceBrands.json';
import w_deviceBridge from './lt/deviceBridge.json';
import w_deviceCamera from './lt/deviceCamera.json';
import w_deviceCards from './lt/deviceCards.json';
import w_deviceConsole from './lt/deviceConsole.json';
import w_deviceEditor from './lt/deviceEditor.json';
import w_deviceFiles from './lt/deviceFiles.json';
import w_deviceHeads from './lt/deviceHeads.json';
import w_deviceJob from './lt/deviceJob.json';
import w_deviceLink from './lt/deviceLink.json';
import w_deviceManage from './lt/deviceManage.json';
import w_deviceMove from './lt/deviceMove.json';
import w_devicePrinterErrors from './lt/devicePrinterErrors.json';
import w_deviceScreen from './lt/deviceScreen.json';
import w_deviceSend from './lt/deviceSend.json';
import w_deviceSlots from './lt/deviceSlots.json';
import w_deviceTimelapse from './lt/deviceTimelapse.json';
import w_devices from './lt/devices.json';
import w_engineSwitch from './lt/engineSwitch.json';
import w_filamentLimit from './lt/filamentLimit.json';
import w_filamentSync from './lt/filamentSync.json';
import w_flowVariant from './lt/flowVariant.json';
import w_flushVolumes from './lt/flushVolumes.json';
import w_fontList from './lt/fontList.json';
import w_gcodeErrors from './lt/gcodeErrors.json';
import w_gcodeFallback from './lt/gcodeFallback.json';
import w_groupMenu from './lt/groupMenu.json';
import w_importPresets from './lt/importPresets.json';
import w_language from './lt/language.json';
import w_layerCodes from './lt/layerCodes.json';
import w_layersPanel from './lt/layersPanel.json';
import w_linkProgram from './lt/linkProgram.json';
import w_loadingScreen from './lt/loadingScreen.json';
import w_measureFigures from './lt/measureFigures.json';
import w_objectList from './lt/objectList.json';
import w_objectMenu from './lt/objectMenu.json';
import w_objectSettings from './lt/objectSettings.json';
import w_open from './lt/open.json';
import w_openProject from './lt/openProject.json';
import w_optionCheck from './lt/optionCheck.json';
import w_optionField from './lt/optionField.json';
import w_paintTool from './lt/paintTool.json';
import w_pickReset from './lt/pickReset.json';
import w_plateIcons from './lt/plateIcons.json';
import w_plateMenu from './lt/plateMenu.json';
import w_plateSettings from './lt/plateSettings.json';
import w_presetChanges from './lt/presetChanges.json';
import w_presetEngines from './lt/presetEngines.json';
import w_presetFiles from './lt/presetFiles.json';
import w_presetMenu from './lt/presetMenu.json';
import w_presetSave from './lt/presetSave.json';
import w_presetSettings from './lt/presetSettings.json';
import w_previewColours from './lt/previewColours.json';
import w_previewTab from './lt/previewTab.json';
import w_printHistory from './lt/printHistory.json';
import w_projectImport from './lt/projectImport.json';
import w_projectMenu from './lt/projectMenu.json';
import w_projectStore from './lt/projectStore.json';
import w_saving from './lt/saving.json';
import w_settingPicker from './lt/settingPicker.json';
import w_settingsCheck from './lt/settingsCheck.json';
import w_settingsPanel from './lt/settingsPanel.json';
import w_settingsPrompt from './lt/settingsPrompt.json';
import w_setupWizard from './lt/setupWizard.json';
import w_shapePlacement from './lt/shapePlacement.json';
import w_shapes from './lt/shapes.json';
import w_sidebar from './lt/sidebar.json';
import w_simplifyFirst from './lt/simplifyFirst.json';
import w_simplifyTool from './lt/simplifyTool.json';
import w_slicerEdits from './lt/slicerEdits.json';
import w_slicerNotices from './lt/slicerNotices.json';
import w_svgTool from './lt/svgTool.json';
import w_tabs from './lt/tabs.json';
import w_textTool from './lt/textTool.json';
import w_theme from './lt/theme.json';
import w_time from './lt/time.json';
import w_timeFormat from './lt/timeFormat.json';
import w_toolPanel from './lt/toolPanel.json';
import w_toolbar from './lt/toolbar.json';
import w_topbar from './lt/topbar.json';
import w_uiParts from './lt/uiParts.json';
import w_viewControls from './lt/viewControls.json';
import w_viewport from './lt/viewport.json';
import w_volumes from './lt/volumes.json';

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
