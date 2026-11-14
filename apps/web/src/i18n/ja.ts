// Japanese, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in ja/ is missing here.
import w_account from './ja/account.json';
import w_accountErrors from './ja/accountErrors.json';
import w_actionbar from './ja/actionbar.json';
import w_adminPage from './ja/adminPage.json';
import w_aiApps from './ja/aiApps.json';
import w_arrangeOptions from './ja/arrangeOptions.json';
import w_askDialog from './ja/askDialog.json';
import w_assembleTool from './ja/assembleTool.json';
import w_backgroundSlice from './ja/backgroundSlice.json';
import w_booleanTool from './ja/booleanTool.json';
import w_brimEars from './ja/brimEars.json';
import w_calibration from './ja/calibration.json';
import w_chooseBar from './ja/chooseBar.json';
import w_clearance from './ja/clearance.json';
import w_colorMixing from './ja/colorMixing.json';
import w_colourPicker from './ja/colourPicker.json';
import w_common from './ja/common.json';
import w_continue from './ja/continue.json';
import w_convertDialog from './ja/convertDialog.json';
import w_cutTool from './ja/cutTool.json';
import w_deviceAddons from './ja/deviceAddons.json';
import w_deviceAlertText from './ja/deviceAlertText.json';
import w_deviceAlerts from './ja/deviceAlerts.json';
import w_deviceArrange from './ja/deviceArrange.json';
import w_deviceBrands from './ja/deviceBrands.json';
import w_deviceBridge from './ja/deviceBridge.json';
import w_deviceCamera from './ja/deviceCamera.json';
import w_deviceCards from './ja/deviceCards.json';
import w_deviceConsole from './ja/deviceConsole.json';
import w_deviceEditor from './ja/deviceEditor.json';
import w_deviceFiles from './ja/deviceFiles.json';
import w_deviceHeads from './ja/deviceHeads.json';
import w_deviceJob from './ja/deviceJob.json';
import w_deviceLink from './ja/deviceLink.json';
import w_deviceManage from './ja/deviceManage.json';
import w_deviceMove from './ja/deviceMove.json';
import w_devicePrinterErrors from './ja/devicePrinterErrors.json';
import w_deviceScreen from './ja/deviceScreen.json';
import w_deviceSend from './ja/deviceSend.json';
import w_deviceSlots from './ja/deviceSlots.json';
import w_deviceTimelapse from './ja/deviceTimelapse.json';
import w_devices from './ja/devices.json';
import w_engineSwitch from './ja/engineSwitch.json';
import w_filamentLimit from './ja/filamentLimit.json';
import w_filamentSync from './ja/filamentSync.json';
import w_flowVariant from './ja/flowVariant.json';
import w_flushVolumes from './ja/flushVolumes.json';
import w_fontList from './ja/fontList.json';
import w_gcodeErrors from './ja/gcodeErrors.json';
import w_gcodeFallback from './ja/gcodeFallback.json';
import w_groupMenu from './ja/groupMenu.json';
import w_importPresets from './ja/importPresets.json';
import w_language from './ja/language.json';
import w_layerCodes from './ja/layerCodes.json';
import w_layersPanel from './ja/layersPanel.json';
import w_linkProgram from './ja/linkProgram.json';
import w_loadingScreen from './ja/loadingScreen.json';
import w_measureFigures from './ja/measureFigures.json';
import w_objectList from './ja/objectList.json';
import w_objectMenu from './ja/objectMenu.json';
import w_objectSettings from './ja/objectSettings.json';
import w_open from './ja/open.json';
import w_openProject from './ja/openProject.json';
import w_optionCheck from './ja/optionCheck.json';
import w_optionField from './ja/optionField.json';
import w_paintTool from './ja/paintTool.json';
import w_pickReset from './ja/pickReset.json';
import w_plateIcons from './ja/plateIcons.json';
import w_plateMenu from './ja/plateMenu.json';
import w_plateSettings from './ja/plateSettings.json';
import w_presetChanges from './ja/presetChanges.json';
import w_presetEngines from './ja/presetEngines.json';
import w_presetFiles from './ja/presetFiles.json';
import w_presetMenu from './ja/presetMenu.json';
import w_presetSave from './ja/presetSave.json';
import w_presetSettings from './ja/presetSettings.json';
import w_previewColours from './ja/previewColours.json';
import w_previewTab from './ja/previewTab.json';
import w_printHistory from './ja/printHistory.json';
import w_projectImport from './ja/projectImport.json';
import w_projectMenu from './ja/projectMenu.json';
import w_projectStore from './ja/projectStore.json';
import w_saving from './ja/saving.json';
import w_settingPicker from './ja/settingPicker.json';
import w_settingsCheck from './ja/settingsCheck.json';
import w_settingsPanel from './ja/settingsPanel.json';
import w_settingsPrompt from './ja/settingsPrompt.json';
import w_setupWizard from './ja/setupWizard.json';
import w_shapePlacement from './ja/shapePlacement.json';
import w_shapes from './ja/shapes.json';
import w_sidebar from './ja/sidebar.json';
import w_simplifyFirst from './ja/simplifyFirst.json';
import w_simplifyTool from './ja/simplifyTool.json';
import w_slicerEdits from './ja/slicerEdits.json';
import w_slicerNotices from './ja/slicerNotices.json';
import w_svgTool from './ja/svgTool.json';
import w_tabs from './ja/tabs.json';
import w_textTool from './ja/textTool.json';
import w_theme from './ja/theme.json';
import w_time from './ja/time.json';
import w_timeFormat from './ja/timeFormat.json';
import w_toolPanel from './ja/toolPanel.json';
import w_toolbar from './ja/toolbar.json';
import w_topbar from './ja/topbar.json';
import w_uiParts from './ja/uiParts.json';
import w_viewControls from './ja/viewControls.json';
import w_viewport from './ja/viewport.json';
import w_volumes from './ja/volumes.json';

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
