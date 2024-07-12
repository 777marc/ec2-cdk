import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import { readFileSync } from "fs";
import {
  Vpc,
  SubnetType,
  Peer,
  Port,
  AmazonLinuxGeneration,
  AmazonLinuxCpuType,
  Instance,
  SecurityGroup,
  AmazonLinuxImage,
  InstanceClass,
  InstanceSize,
  InstanceType,
} from "aws-cdk-lib/aws-ec2";
import { Role, ServicePrincipal, ManagedPolicy } from "aws-cdk-lib/aws-iam";
import { Pipeline, Artifact } from "aws-cdk-lib/aws-codepipeline";
import {
  GitHubSourceAction,
  CodeBuildAction,
  CodeDeployServerDeployAction,
} from "aws-cdk-lib/aws-codepipeline-actions";
import { PipelineProject, LinuxBuildImage } from "aws-cdk-lib/aws-codebuild";
import {
  ServerDeploymentGroup,
  ServerApplication,
  InstanceTagSet,
} from "aws-cdk-lib/aws-codedeploy";
import { SecretValue } from "aws-cdk-lib";

export class Ec2CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // BEGIN

    const webServerRole = new Role(this, "ec2Role", {
      assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
    });

    // IAM policy attachment to allow access to
    webServerRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore")
    );

    webServerRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName(
        "service-role/AmazonEC2RoleforAWSCodeDeploy"
      )
    );

    // This VPC has 3 public subnets, and that's it
    const vpc = new Vpc(this, "main_vpc", {
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "pub01",
          subnetType: SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "pub02",
          subnetType: SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "pub03",
          subnetType: SubnetType.PUBLIC,
        },
      ],
    });

    // Security Groups
    // This SG will only allow HTTP traffic to the Web server
    const webSg = new SecurityGroup(this, "web_sg", {
      vpc,
      description: "Allows Inbound HTTP traffic to the web server.",
      allowAllOutbound: true,
    });

    webSg.addIngressRule(Peer.anyIpv4(), Port.tcp(80));

    // the AMI to be used for the EC2 Instance
    const ami = new AmazonLinuxImage({
      generation: AmazonLinuxGeneration.AMAZON_LINUX_2023,
      cpuType: AmazonLinuxCpuType.X86_64,
    });

    // The actual Web EC2 Instance for the web server
    const webServer = new Instance(this, "web_server", {
      vpc,
      instanceType: InstanceType.of(InstanceClass.T2, InstanceSize.MICRO),
      machineImage: ami,
      securityGroup: webSg,
      role: webServerRole,
    });

    // User data - used for bootstrapping
    const webSGUserData = readFileSync(
      "./assets/configure_amz_linux_sample_app.sh",
      "utf-8"
    );
    webServer.addUserData(webSGUserData);
    // Tag the instance
    cdk.Tags.of(webServer).add("application-name", "node-web");
    cdk.Tags.of(webServer).add("stage", "prod");

    // CodePipeline
    const pipeline = new Pipeline(this, "node_web_pipeline", {
      pipelineName: "node-webApp",
      crossAccountKeys: false, // solves the encrypted bucket issue
    });

    // STAGES
    // Source Stage
    const sourceStage = pipeline.addStage({
      stageName: "Source",
    });

    // Build Stage
    const buildStage = pipeline.addStage({
      stageName: "Build",
    });

    // Deploy Stage
    const deployStage = pipeline.addStage({
      stageName: "Deploy",
    });

    // Source action
    const sourceOutput = new Artifact();
    const githubSourceAction = new GitHubSourceAction({
      actionName: "GithubSource",
      oauthToken: SecretValue.secretsManager("github-oauth-token"), // MAKE SURE TO SET UP BEFORE
      owner: "777marc", // THIS NEEDS TO BE CHANGED TO YOUR OWN USER ID
      repo: "ts-node-express",
      branch: "main",
      output: sourceOutput,
    });

    sourceStage.addAction(githubSourceAction);

    // Build Action
    const nodeTestProject = new PipelineProject(this, "nodeTestProject", {
      environment: {
        buildImage: LinuxBuildImage.AMAZON_LINUX_2_5,
      },
    });

    const nodeTestOutput = new Artifact();

    const nodeTestAction = new CodeBuildAction({
      actionName: "TestNode",
      project: nodeTestProject,
      input: sourceOutput,
      outputs: [nodeTestOutput],
    });

    buildStage.addAction(nodeTestAction);

    // Deploy Actions
    const nodeDeployApplication = new ServerApplication(
      this,
      "node_deploy_application",
      {
        applicationName: "node-webApp",
      }
    );

    // Deployment group
    const nodeServerDeploymentGroup = new ServerDeploymentGroup(
      this,
      "nodeAppDeployGroup",
      {
        application: nodeDeployApplication,
        deploymentGroupName: "nodeAppDeploymentGroup",
        installAgent: true,
        ec2InstanceTags: new InstanceTagSet({
          "application-name": ["node-web"],
          stage: ["prod", "stage"],
        }),
      }
    );

    // Deployment action
    const nodeDeployAction = new CodeDeployServerDeployAction({
      actionName: "NodeAppDeployment",
      input: sourceOutput,
      deploymentGroup: nodeServerDeploymentGroup,
    });

    deployStage.addAction(nodeDeployAction);

    // Output the public IP address of the EC2 instance
    new cdk.CfnOutput(this, "IP Address", {
      value: webServer.instancePublicIp,
    });
    // END
  }
}
