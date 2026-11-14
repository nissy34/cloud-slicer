// Russian, as one file fetched only when picked (i18n/index.ts). Each word file is
// listed by name (not import.meta.glob) so code shared with Node can type-check it.
// Written by scripts/word-lists.mjs; words.test.ts fails when a file in ru/ is missing here.
import w_account from './ru/account.json';
import w_accountErrors from './ru/accountErrors.json';
import w_actionbar from './ru/actionbar.json';
import w_adminPage from './ru/adminPage.json';
import w_aiApps from './ru/aiApps.json';
import w_arrangeOptions from './ru/arrangeOptions.json';
import w_askDialog from './ru/askDialog.json';
import w_assembleTool from './ru/assembleTool.json';
import w_backgroundSlice from './ru/backgroundSlice.json';
import w_booleanTool from './ru/booleanTool.json';
import w_brimEars from './ru/brimEars.json';
import w_calibration from './ru/calibration.json';
import w_chooseBar from './ru/chooseBar.json';
import w_clearance from './ru/clearance.json';
import w_colorMixing from './ru/colorMixing.json';
import w_colourPicker from './ru/colourPicker.json';
import w_common from './ru/common.json';
import w_continue from './ru/continue.json';
import w_convertDialog from './ru/convertDialog.json';
import w_cutTool from './ru/cutTool.json';
import w_deviceAddons from './ru/deviceAddons.json';
import w_deviceAlertText from './ru/deviceAlertText.json';
import w_deviceAlerts from './ru/deviceAlerts.json';
import w_deviceArrange from './ru/deviceArrange.json';
import w_deviceBrands from './ru/deviceBrands.json';
import w_deviceBridge from './ru/deviceBridge.json';
import w_deviceCamera from './ru/deviceCamera.json';
import w_deviceCards from './ru/deviceCards.json';
import w_deviceConsole from './ru/deviceConsole.json';
import w_deviceEditor from './ru/deviceEditor.json';
import w_deviceFiles from './ru/deviceFiles.json';
import w_deviceHeads from './ru/deviceHeads.json';
import w_deviceJob from './ru/deviceJob.json';
import w_deviceLink from './ru/deviceLink.json';
import w_deviceManage from './ru/deviceManage.json';
import w_deviceMove from './ru/deviceMove.json';
import w_devicePrinterErrors from './ru/devicePrinterErrors.json';
import w_deviceScreen from './ru/deviceScreen.json';
import w_deviceSend from './ru/deviceSend.json';
import w_deviceSlots from './ru/deviceSlots.json';
import w_deviceTimelapse from './ru/deviceTimelapse.json';
import w_devices from './ru/devices.json';
import w_engineSwitch from './ru/engineSwitch.json';
import w_filamentLimit from './ru/filamentLimit.json';
import w_filamentSync from './ru/filamentSync.json';
import w_flowVariant from './ru/flowVariant.json';
import w_flushVolumes from './ru/flushVolumes.json';
import w_fontList from './ru/fontList.json';
import w_gcodeErrors from './ru/gcodeErrors.json';
import w_gcodeFallback from './ru/gcodeFallback.json';
import w_groupMenu from './ru/groupMenu.json';
import w_importPresets from './ru/importPresets.json';
import w_language from './ru/language.json';
import w_layerCodes from './ru/layerCodes.json';
import w_layersPanel from './ru/layersPanel.json';
import w_linkProgram from './ru/linkProgram.json';
import w_loadingScreen from './ru/loadingScreen.json';
import w_measureFigures from './ru/measureFigures.json';
import w_objectList from './ru/objectList.json';
import w_objectMenu from './ru/objectMenu.json';
import w_objectSettings from './ru/objectSettings.json';
import w_open from './ru/open.json';
import w_openProject from './ru/openProject.json';
import w_optionCheck from './ru/optionCheck.json';
import w_optionField from './ru/optionField.json';
import w_paintTool from './ru/paintTool.json';
import w_pickReset from './ru/pickReset.json';
import w_plateIcons from './ru/plateIcons.json';
import w_plateMenu from './ru/plateMenu.json';
import w_plateSettings from './ru/plateSettings.json';
import w_presetChanges from './ru/presetChanges.json';
import w_presetEngines from './ru/presetEngines.json';
import w_presetFiles from './ru/presetFiles.json';
import w_presetMenu from './ru/presetMenu.json';
import w_presetSave from './ru/presetSave.json';
import w_presetSettings from './ru/presetSettings.json';
import w_previewColours from './ru/previewColours.json';
import w_previewTab from './ru/previewTab.json';
import w_printHistory from './ru/printHistory.json';
import w_projectImport from './ru/projectImport.json';
import w_projectMenu from './ru/projectMenu.json';
import w_projectStore from './ru/projectStore.json';
import w_saving from './ru/saving.json';
import w_settingPicker from './ru/settingPicker.json';
import w_settingsCheck from './ru/settingsCheck.json';
import w_settingsPanel from './ru/settingsPanel.json';
import w_settingsPrompt from './ru/settingsPrompt.json';
import w_setupWizard from './ru/setupWizard.json';
import w_shapePlacement from './ru/shapePlacement.json';
import w_shapes from './ru/shapes.json';
import w_sidebar from './ru/sidebar.json';
import w_simplifyFirst from './ru/simplifyFirst.json';
import w_simplifyTool from './ru/simplifyTool.json';
import w_slicerEdits from './ru/slicerEdits.json';
import w_slicerNotices from './ru/slicerNotices.json';
import w_svgTool from './ru/svgTool.json';
import w_tabs from './ru/tabs.json';
import w_textTool from './ru/textTool.json';
import w_theme from './ru/theme.json';
import w_time from './ru/time.json';
import w_timeFormat from './ru/timeFormat.json';
import w_toolPanel from './ru/toolPanel.json';
import w_toolbar from './ru/toolbar.json';
import w_topbar from './ru/topbar.json';
import w_uiParts from './ru/uiParts.json';
import w_viewControls from './ru/viewControls.json';
import w_viewport from './ru/viewport.json';
import w_volumes from './ru/volumes.json';

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
