// Turkish, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in tr/ is missing here.
import w_account from './tr/account.json';
import w_accountErrors from './tr/accountErrors.json';
import w_actionbar from './tr/actionbar.json';
import w_adminPage from './tr/adminPage.json';
import w_aiApps from './tr/aiApps.json';
import w_arrangeOptions from './tr/arrangeOptions.json';
import w_askDialog from './tr/askDialog.json';
import w_assembleTool from './tr/assembleTool.json';
import w_backgroundSlice from './tr/backgroundSlice.json';
import w_booleanTool from './tr/booleanTool.json';
import w_brimEars from './tr/brimEars.json';
import w_calibration from './tr/calibration.json';
import w_chooseBar from './tr/chooseBar.json';
import w_clearance from './tr/clearance.json';
import w_colorMixing from './tr/colorMixing.json';
import w_colourPicker from './tr/colourPicker.json';
import w_common from './tr/common.json';
import w_continue from './tr/continue.json';
import w_convertDialog from './tr/convertDialog.json';
import w_cutTool from './tr/cutTool.json';
import w_deviceAddons from './tr/deviceAddons.json';
import w_deviceAlertText from './tr/deviceAlertText.json';
import w_deviceAlerts from './tr/deviceAlerts.json';
import w_deviceArrange from './tr/deviceArrange.json';
import w_deviceBrands from './tr/deviceBrands.json';
import w_deviceBridge from './tr/deviceBridge.json';
import w_deviceCamera from './tr/deviceCamera.json';
import w_deviceCards from './tr/deviceCards.json';
import w_deviceConsole from './tr/deviceConsole.json';
import w_deviceEditor from './tr/deviceEditor.json';
import w_deviceFiles from './tr/deviceFiles.json';
import w_deviceHeads from './tr/deviceHeads.json';
import w_deviceJob from './tr/deviceJob.json';
import w_deviceLink from './tr/deviceLink.json';
import w_deviceManage from './tr/deviceManage.json';
import w_deviceMove from './tr/deviceMove.json';
import w_devicePrinterErrors from './tr/devicePrinterErrors.json';
import w_deviceScreen from './tr/deviceScreen.json';
import w_deviceSend from './tr/deviceSend.json';
import w_deviceSlots from './tr/deviceSlots.json';
import w_deviceTimelapse from './tr/deviceTimelapse.json';
import w_devices from './tr/devices.json';
import w_engineSwitch from './tr/engineSwitch.json';
import w_filamentLimit from './tr/filamentLimit.json';
import w_filamentSync from './tr/filamentSync.json';
import w_flowVariant from './tr/flowVariant.json';
import w_flushVolumes from './tr/flushVolumes.json';
import w_fontList from './tr/fontList.json';
import w_gcodeErrors from './tr/gcodeErrors.json';
import w_gcodeFallback from './tr/gcodeFallback.json';
import w_groupMenu from './tr/groupMenu.json';
import w_importPresets from './tr/importPresets.json';
import w_language from './tr/language.json';
import w_layerCodes from './tr/layerCodes.json';
import w_layersPanel from './tr/layersPanel.json';
import w_linkProgram from './tr/linkProgram.json';
import w_loadingScreen from './tr/loadingScreen.json';
import w_measureFigures from './tr/measureFigures.json';
import w_objectList from './tr/objectList.json';
import w_objectMenu from './tr/objectMenu.json';
import w_objectSettings from './tr/objectSettings.json';
import w_open from './tr/open.json';
import w_openProject from './tr/openProject.json';
import w_optionCheck from './tr/optionCheck.json';
import w_optionField from './tr/optionField.json';
import w_paintTool from './tr/paintTool.json';
import w_pickReset from './tr/pickReset.json';
import w_plateIcons from './tr/plateIcons.json';
import w_plateMenu from './tr/plateMenu.json';
import w_plateSettings from './tr/plateSettings.json';
import w_presetChanges from './tr/presetChanges.json';
import w_presetEngines from './tr/presetEngines.json';
import w_presetFiles from './tr/presetFiles.json';
import w_presetMenu from './tr/presetMenu.json';
import w_presetSave from './tr/presetSave.json';
import w_presetSettings from './tr/presetSettings.json';
import w_previewColours from './tr/previewColours.json';
import w_previewTab from './tr/previewTab.json';
import w_printHistory from './tr/printHistory.json';
import w_projectImport from './tr/projectImport.json';
import w_projectMenu from './tr/projectMenu.json';
import w_projectStore from './tr/projectStore.json';
import w_saving from './tr/saving.json';
import w_settingPicker from './tr/settingPicker.json';
import w_settingsCheck from './tr/settingsCheck.json';
import w_settingsPanel from './tr/settingsPanel.json';
import w_settingsPrompt from './tr/settingsPrompt.json';
import w_setupWizard from './tr/setupWizard.json';
import w_shapePlacement from './tr/shapePlacement.json';
import w_shapes from './tr/shapes.json';
import w_sidebar from './tr/sidebar.json';
import w_simplifyFirst from './tr/simplifyFirst.json';
import w_simplifyTool from './tr/simplifyTool.json';
import w_slicerEdits from './tr/slicerEdits.json';
import w_slicerNotices from './tr/slicerNotices.json';
import w_svgTool from './tr/svgTool.json';
import w_tabs from './tr/tabs.json';
import w_textTool from './tr/textTool.json';
import w_theme from './tr/theme.json';
import w_time from './tr/time.json';
import w_timeFormat from './tr/timeFormat.json';
import w_toolPanel from './tr/toolPanel.json';
import w_toolbar from './tr/toolbar.json';
import w_topbar from './tr/topbar.json';
import w_uiParts from './tr/uiParts.json';
import w_viewControls from './tr/viewControls.json';
import w_viewport from './tr/viewport.json';
import w_volumes from './tr/volumes.json';

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
