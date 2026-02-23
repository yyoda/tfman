# Terraform CI/CD Reference Implementation using GitHub Actions

This repository serves as a reference implementation for managing multi-cloud, multi-account, and monorepo infrastructure using Terraform and GitHub Actions.

## 📁 Directory Structure

The project follows a standard structure:

- **`environments/`**: Contains environment-specific Terraform configurations (Root Modules) such as `test1`, `test2`. Each directory corresponds to a separate Terraform State.
- **`modules/`**: Contains reusable Terraform modules shared across environments.
- **`.github/`**: Contains GitHub Actions workflows, scripts, and related documentation.

## 🚀 CI/CD & Operations

For details on the CI/CD pipeline (Plan, Apply, Drift Detection) and operational scripts, please refer to the documentation below:

- [**CI/CD & Operational Tools Documentation**](.github/README.md)

## 🛠 Developer Guide

- **Version Management**: Terraform version is managed via `.terraform-version` file.
