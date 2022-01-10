import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, TAbstractFile } from 'obsidian';
import { TextInputSuggest } from "suggest";

// Remember to rename these classes and interfaces!

interface MyPluginSettings {
	variableFile: string,
	debugPrint: boolean,
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	variableFile: "",
	debugPrint: false,
}

export interface IHash {
    [details: string] : any;
} 

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	variableList: IHash = {};
	substitutionRegex = /(<span class="var-start">([\w-]+)<\/span>).*(<span class="var-end">([\w-]+)<\/span>)/g;

	async onload() {
		await this.loadSettings();

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon('dice', 'Sample Plugin', (evt: MouseEvent) => {
			// Called when the user clicks the icon.
			new Notice('This is a notice!');
		});
		// Perform additional things with the ribbon
		ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText('Status Bar Text');

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: 'substitute-variable-in-current-page',
			name: 'Substitute variable in current page',
			callback: () => {
				this.loadVariable();
				this.substitution(this.app.workspace.getActiveFile());
			}
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: 'sample-editor-command',
			name: 'Sample editor command',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection('Sample Editor Command');
			}
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: 'substitute-variable-in-all-pages',
			name: 'Substitute variable in all pages',
			callback: () => {
				this.loadVariable();
				this.substitutionAll();
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
			console.log('click', evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
	}

	onunload() {

	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	loadVariable(){
		this.app.vault.adapter.read(this.settings.variableFile)
			.then((text) => {
				var lines = text.split("\n");
				lines.forEach(line => {
					var splits = line.split(/:(?<!\\:)/);
					if(splits.length==2){
						this.variableList[splits[0]] = splits[1];
					}
				});
			})
			.catch((err) => {
				console.error(err);
				new Notice(err);
			})
			.finally(() => {
				// console.log(this.variableList);
			});
	}

	substitution = (file:TFile, singleFile=true):Promise<[boolean,IHash]> => {
		let variableStatus:IHash = {}
		let hasSubstitution = false;
	
		return new Promise((resolve, reject) => {
			this.app.vault.adapter.read(file.path)
			.then((text) => {
				var lines = text.split("\n");
				lines.forEach((line, n) => {
					var regex_out = this.substitutionRegex.exec(line);
					if(regex_out){
						var start_var = regex_out[2];
						var end_var = regex_out[4];
						var start_syntax = regex_out[1];
						var end_syntax = regex_out[3];
						if (!variableStatus[start_var]) {
							variableStatus[start_var] = {}
						}
						if (start_var != end_var){
							new Notice(`${start_var} and ${end_var} does not match at line ${n} of ${file.path}`);
							variableStatus[start_var]["error"] = `${start_var} and ${end_var} does not match at line ${n}`;
						}
						else if(!(start_var in this.variableList)){
							new Notice(`${start_var} is not defined`);
							variableStatus[start_var]["error"] = `${start_var} is not defined`;
						}
						if(regex_out[0] == start_syntax+this.variableList[start_var]+end_syntax){
							variableStatus[start_var]["modified"] = false;
						}else{
							variableStatus[start_var]["modified"] = true;
							hasSubstitution = true;
							lines[n] = line.replace(this.substitutionRegex,start_syntax+this.variableList[start_var]+end_syntax);
						}
					}
				});
				if(hasSubstitution){
					this.app.vault.adapter.write(file.path,lines.join("\n"))
						.then(() => {
							if(singleFile)
								new Notice(`Substitution is done`);
						})
						.catch((err) => {
							console.error(err);
							new Notice(err);
						});
				}else if(!Utils.isEmpty(variableStatus)){
					if(singleFile)
						new Notice(`Nothing is updated`);
				}
				else{
					if(singleFile)
						new Notice(`No variable is found`);
				}
			})
			.catch((err) => {
				console.error(err);
				new Notice(err);
			})
			.finally(() => {
				resolve([hasSubstitution,variableStatus]);
				if(singleFile && this.settings.debugPrint)
					console.log(variableStatus);
			});
		})
	}

	substitutionAll(){
		const all_files = Utils.get_tfiles_from_folder(this.app, this.settings.variableFile);
		let overallStatus: IHash = {};
		let updatedFileCount = 0;
		var complete = new Promise((resolve, reject) => {
			all_files.forEach(async (file, index, array) => {
				const result:IHash = await this.substitution(file,false);
				if(!Utils.isEmpty(result[1]) && this.settings.debugPrint){
					overallStatus[file.path] = result[1];
				}
				if(result[0]){
					updatedFileCount+=1;
				}
				if (index === array.length -1) 
					resolve(updatedFileCount);
			});
		});

		complete.then(() => {
			if(this.settings.debugPrint){
				console.log(`${updatedFileCount} file is modified`);
				console.log(overallStatus);
			}
			if(updatedFileCount>0)
				new Notice(`Substitution is done`);
			else
				new Notice(`Nothing is updated`);
		});
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.setText('Woah!');
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'Settings for Variable Substitution.'});

		new Setting(containerEl)
			.setName('Variable File Location')
			.setDesc('File where variables are defined')
			.addSearch((cb) => {
				new FileSuggest(
					this.app,
					cb.inputEl,
					this.plugin,
				);
				cb.setPlaceholder("Example: folder1/template_file")
					.setValue(this.plugin.settings.variableFile)
					.onChange((new_template) => {
						this.plugin.settings.variableFile = new_template;
						this.plugin.saveData(this.plugin.settings);
					})
			});
		
		new Setting(containerEl)
            .setName("Debug Print")
            .setDesc(
                "Print the list of variables for each file"
            )
            .addToggle(toggle => {
                toggle
                    .setValue(this.plugin.settings.debugPrint)
                    .onChange(async value => {
                        this.plugin.settings.debugPrint = value;
                        await this.plugin.saveSettings();
                    });
            });
	}
}

// Credits go to Liam's Periodic Notes Plugin: https://github.com/liamcain/obsidian-periodic-notes. 
// Slight modification to reduce the dependency on other modules
class FileSuggest extends TextInputSuggest<TFile> {
    constructor(
        public app: App,
        public inputEl: HTMLInputElement,
        private plugin: MyPlugin,
    ) {
        super(app, inputEl);
    }

    get_folder(): string {
        return this.plugin.settings.variableFile;
    }

    getSuggestions(input_str: string): TFile[] {
        const all_files = Utils.get_tfiles_from_folder(this.app, this.get_folder());
        if (!all_files) {
            return [];
        }

        const files: TFile[] = [];
        const lower_input_str = input_str.toLowerCase();

        all_files.forEach((file: TAbstractFile) => {
            if (
                file instanceof TFile &&
                file.extension === "md" &&
                file.path.toLowerCase().contains(lower_input_str)
            ) {
                files.push(file);
            }
        });

        return files;
    }

    renderSuggestion(file: TFile, el: HTMLElement): void {
        el.setText(file.path);
    }

    selectSuggestion(file: TFile): void {
        this.inputEl.value = file.path;
        this.inputEl.trigger("input");
        this.close();
    }

	
}

class Utils {
	static get_tfiles_from_folder(
		app: App,
		folder_str: string
	): Array<TFile> {	
		const files: Array<TFile> = app.vault.getFiles()
	
		files.sort((a, b) => {
			return a.basename.localeCompare(b.basename);
		});
	
		return files;
	}

	static isEmpty(obj:Object) {
		return Object.keys(obj).length == 0;
	}
}