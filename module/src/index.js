const Noodl = require('@noodl/noodl-sdk');
const Parse = require('parse');

let userObject; //Noodl.Object not available yet when this line runs, so create this object later

function updateUserObject() {
	const user = Parse.User.current();
	const attributes = user ? user.attributes : {};

	userObject.setAll({
		...attributes,
		userId: user ? user.id : null,
		authenticated: user ? user.authenticated() : false
	});
}

function setCustomUserProperty(name, value) {
	userObject.set(name, value);
	Parse.User.current().set(name, value);
}

function initializeParse(cloudservices) {

 	userObject = Noodl.Object.get('_noodl_user_');

	if(!cloudservices) {
		console.error("Cloud services must be enabled for Parse to work");
		return;
	}

	const {endpoint, instanceId, workspaceId} = cloudservices;
	Parse.initialize(`${workspaceId}-${instanceId}`);
	Parse.serverURL = endpoint;

	updateUserObject(); //check for cached login
}

const SignUp = Noodl.defineNode({
	category:'Backend',
	name:'Sign Up',
	color:'green',
	inputs:{
		email: {type: 'string', group: 'User Data'},
		username: {type: 'string', group: 'User Data'},
		password: {type: 'string', group: 'User Data'},
	},
	outputs: {
		success: {type: 'signal', group: 'success'},
		error: {type: 'signal', group: 'error'},
		errorMessage: {type: 'string', group: 'error'},
		errorCode: {type: 'string', group: 'error'},
	},
	signals: {
		signup: {
			displayName: 'Sign Up',
			signal() {

				this.setOutputs({
					errorMessage: "",
					errorCode: ""
				});

				const user = new Parse.User();
				user.set("username", this.inputs.username);
				user.set("password", this.inputs.password);
				user.set("email", this.inputs.email);

				user.signUp().then(() => {
						this.sendSignalOnOutput('success');
						updateUserObject();
					})
					.catch(error => {
						this.setOutputs({
							errorMessage: error.message,
							errorCode: error.code
						});
						this.sendSignalOnOutput('error');
					});
			}
		}
	}
});

const LogIn = Noodl.defineNode({
	category:'Backend',
	name:'Log In',
	color:'green',
	inputs:{
		username: {type: 'string', group: 'User Data'},
		password: {type: 'string', group: 'User Data'},
	},
	outputs: {
		success: {type: 'signal', group: 'success'},
		error: {type: 'signal', group: 'error'},
		errorMessage: {type: 'string', group: 'error'},
		errorCode: {type: 'string', group: 'error'},
	},
	signals: {
		login() {
			this.setOutputs({
				errorMessage: "",
				errorCode: ""
			});

			Parse.User.logIn(this.inputs.username, this.inputs.password).then(user => {
				this.sendSignalOnOutput('success');
				updateUserObject();
			})
			.catch(error => {
				this.setOutputs({
					errorMessage: error.message,
					errorCode: error.code
				});
				this.sendSignalOnOutput('error');
			});
		}
	},
	changed:{
	},
	setup(context, graphModel) {
		graphModel.on('editorImportComplete', () => {
			initializeParse(Noodl.getMetaData().cloudservices);
		});
	}
});

const readOnlyUserProps = {
	userId: {displayName: 'Id', type: 'string', group: 'Read only data'},
	email: {type: 'string', group: 'Read only data'},
	username: {type: 'string', group: 'Read only data'},
	createdAt: {type: 'string', group: 'Read only data'},
	updatedAt: {type: 'string', group: 'Read only data'},
	authenticated: {type: 'boolean', group: 'Read only data'}
};

const User = Noodl.defineNode({
	category:'Backend',
	name:'User',
	color:'green',
	initialize() {
		this.onPropertyUpdated = ({name, value}) => {
			if(readOnlyUserProps[name]) {
				const output = {};
				output[name] = value;
				this.setOutputs(output);
			}
			else if(this.hasOutput(name)) {
				//dynamic output
				this.flagOutputDirty(name);
			}
		};

		userObject.on('change', this.onPropertyUpdated);

		const startValues = {};
		for(const prop in readOnlyUserProps) {
			startValues[prop] = userObject.get(prop);
		}
		this.setOutputs(startValues);

		this.valuesToStore = {};
	},
	methods: {
		onNodeDeleted() {
			userObject.off('change', this.onPropertyUpdated);
		},
		registerOutputIfNeeded: function (name) {
			if (this.hasOutput(name)) {
			  return;
			}
	  
			this.registerOutput(name, {
			  get() { return userObject.get(name, { resolve: true }) }
			});
		  },
		  registerInputIfNeeded: function (name) {
		  	if (this.hasInput(name)) {
		  		return;
		  	}

		  	this.registerInput(name, {
		  		set(value) {
					this.valuesToStore[name] = value;
		  		}
		  	});
		  }
	},
	signals: {
		store: {
			displayName: 'Store',
			signal() {
				const user = Parse.User.current();
				if(!user) {
					this.setOutputs({
						errorMessage: "User not logged in"
					});
					this.sendSignalOnOutput("error");
					return;
				}

				for(const prop in this.valuesToStore) {
					setCustomUserProperty(prop, this.valuesToStore[prop]);
				}

				user.save()
					.then(
						() => {
							this.sendSignalOnOutput('stored');
							this.valuesToStore = {};
						},
						error => {
							this.setOutputs({
								errorMessage: error.message,
								errorCode: error.code
							});
							this.sendSignalOnOutput('error');
						}
					);
			}
		}
	},
	inputs: {
		properties: {
			type: { name: 'stringlist', allowEditOnly: true },
			displayName: 'Custom User Data',
			group: 'Custom User Data',
		}
	},
	outputs: {
		...readOnlyUserProps,
		stored: {type: 'signal', group: 'success'},
		error: {type: 'signal', group: 'error'},
		errorMessage: {type: 'string', group: 'error'},
		errorCode: {type: 'string', group: 'error'},
	},
	setup(context, graphModel) {
		if (!context.editorConnection || !context.editorConnection.isRunningLocally()) {
			return;
		}
	
		graphModel.on("nodeAdded.User", function (node) {
			updateUserPorts(node.id, node.parameters, context.editorConnection);
	
			node.on("parameterUpdated", function (event) {
				updateUserPorts(node.id, node.parameters, context.editorConnection);
			});
		});
	}
});

function updateUserPorts(nodeId, parameters, editorConnection) {

	const properties = parameters.properties ? parameters.properties.split(',') : [];
	const ports = properties.map(p => {
		return {
			type: {
				name: '*',
				allowConnectionsOnly: true
			},
			plug: 'input/output',
			group: 'Custom User Data',
			name: p,
		}
	});

	editorConnection.sendDynamicPorts(nodeId, ports, {
		detectRenamed: {
			plug: 'input/output',
		}
	});
}

const Logout = Noodl.defineNode({
	category:'Backend',
	name:'Log Out',
	color:'green',
	signals: {
		logout: {
			displayName: 'Log Out',
			signal() {
				Parse.User.logOut()
					.then(() => {
						this.sendSignalOnOutput('success');
						updateUserObject();
					})
					.catch(error => {
						this.setOutputs({
							errorMessage: error.message,
							errorCode: error.code
						});
						this.sendSignalOnOutput('error');
					});
			}
		}
	},
	outputs: {
		success: {type: 'signal', group: 'success'},
		error: {type: 'signal', group: 'error'},
		errorMessage: {type: 'string', group: 'error'},
		errorCode: {type: 'string', group: 'error'},
	}
});

Noodl.defineModule({
    nodes:[
		SignUp,
		LogIn,
		User,
		Logout
    ],
    setup() {
    	//this is called once on startup
    }
});