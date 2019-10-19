const mongoose = require("mongoose");
const moment = require("moment");
const Sequelize = require("sequelize");

const externalDbConnection = require("../modules/externalDbConnection");

const Chart = require("../models/Chart");
const Dataset = require("../models/Dataset");
const DatasetController = require("./DatasetController");
const ConnectionController = require("./ConnectionController");
const ProjectController = require("./ProjectController");
const ApiRequestController = require("./ApiRequestController");

// charts
const LineChart = require("../charts/LineChart");
const BarChart = require("../charts/BarChart");
const PieChart = require("../charts/PieChart");

class ChartController {
  constructor() {
    this.chart = Chart;
    this.connection = new ConnectionController();
    this.dataset = new DatasetController();
    this.project = new ProjectController();
    this.apiRequestController = new ApiRequestController();
  }

  create(data) {
    let chartId;
    return this.chart.create(data)
      .then((chart) => {
        chartId = chart.id;
        if (data.Datasets || data.apiRequest) {
          const createPromises = [];

          // add the datasets creation
          if (data.Datasets) {
            for (const dataset of data.Datasets) {
              if (!dataset.deleted) {
                dataset.chart_id = chartId;
                createPromises.push(this.dataset.create(dataset));
              }
            }
          }

          // add the apiRequest creation
          if (data.apiRequest) {
            const { apiRequest } = data;
            apiRequest.chart_id = chart.id;
            createPromises.push(this.apiRequestController.create(apiRequest));
          }

          // add the update promise as well
          createPromises.push(this.update(chart.id, { dashboardOrder: chart.id }));
          return Promise.all(createPromises);
        } else {
          return this.update(chart.id, { dashboardOrder: chart.id });
        }
      })
      .then(() => {
        return this.findById(chartId);
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  findAll(conditions = {}) {
    return this.chart.findAll(conditions)
      .then((charts) => {
        return new Promise(resolve => resolve(charts));
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  findByProject(projectId) {
    return this.chart.findAll({
      where: { project_id: projectId },
      order: [["dashboardOrder", "ASC"]],
      include: [{ model: Dataset }],
    })
      .then((charts) => {
        // migrate the chart config
        // const newCharts = charts.map((chart) => {
        //   const newChart = chart;
        //   const newChartData = {
        //     series: chart.chartData.data.datasets,
        //     options: {
        //       chart: {
        //         type: "line",
        //         zoom: {
        //           enabled: true,
        //         },
        //       },
        //       xaxis: {
        //         categories: chart.chartData.data.labels,
        //       },
        //       dataLabels: {
        //         enabled: true,
        //       },
        //       stroke: {
        //         curve: "smooth"
        //       },
        //     }
        //   };
        //
        //   newChart.chartData = newChartData;
        //
        //   return newChart;
        // });

        return charts;
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  findById(id) {
    return this.chart.findOne({
      where: { id },
      include: [{ model: Dataset }],
    })
      .then((chart) => {
        return chart;
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  update(id, data) {
    if (data.autoUpdate) {
      return this.chart.update(data, { where: { id } })
        .then(() => {
          const updatePromises = [];
          if (data.Datasets || data.apiRequest) {
            if (data.Datasets) {
              updatePromises
                .push(this.updateDatasets(id, data.Datasets));
            }
            if (data.apiRequest) {
              updatePromises
                .push(this.apiRequestController.update(data.apiRequest.id, data.apiRequest));
            }

            return Promise.all(updatePromises).then(() => this.findById(id));
          } else {
            return this.findById(id);
          }
        })
        .catch((error) => {
          return new Promise((resolve, reject) => reject(error));
        });
    }

    return this.chart.update(data, {
      where: { id },
    })
      .then(() => {
        const updatePromises = [];
        if (data.Datasets || data.apiRequest) {
          if (data.Datasets) {
            updatePromises
              .push(this.updateDatasets(id, data.Datasets));
          }
          if (data.apiRequest) {
            updatePromises
              .push(this.apiRequestController.update(data.apiRequest.id, data.apiRequest));
          }

          return Promise.all(updatePromises).then(() => this.findById(id));
        } else {
          return this.findById(id);
        }
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  updateDatasets(chartId, datasets) {
    const updatePromises = [];
    for (const dataset of datasets) {
      if (dataset.id && !dataset.deleted) {
        if (parseInt(dataset.chart_id, 10) === parseInt(chartId, 10)) {
          updatePromises.push(this.dataset.update(dataset.id, dataset));
        }
      } else if (dataset.id && dataset.deleted) {
        updatePromises.push(this.dataset.remove(dataset.id));
      } else if (!dataset.id && !dataset.deleted) {
        dataset.chart_id = chartId;
        updatePromises.push(this.dataset.create(dataset));
      }
    }

    return Promise.all(updatePromises)
      .then(() => {
        return this.findById(chartId);
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  changeDashboardOrder(selectedId, otherId) {
    let selectedChart;
    return this.findById(selectedId)
      .then((chart) => {
        selectedChart = chart;

        return this.findById(otherId);
      })
      .then((otherChart) => {
        const updateSelected = this.update(selectedId, {
          dashboardOrder: otherChart.dashboardOrder,
        });
        const updateNeighbour = this.update(otherChart.id, {
          dashboardOrder: selectedChart.dashboardOrder,
        });

        return Promise.all([updateSelected, updateNeighbour]);
      })
      .then((values) => {
        return values;
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  remove(id) {
    return this.chart.destroy({ where: { id } })
      .then((response) => {
        return response;
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  updateChartData(id) {
    let gChart;
    return this.findById(id)
      .then((chart) => {
        if (!chart) throw new Error(404);
        gChart = chart;
        return this.connection.findById(chart.connection_id);
      })
      .then((connection) => {
        if (connection.type === "mongodb") {
          return this.runQuery(id);
        } else if (connection.type === "api") {
          return this.runRequest(gChart);
        } else if (connection.type === "postgres" || connection.type === "mysql") {
          return this.runPostgresQuery(gChart);
        } else {
          throw new Error("Invalid connection type");
        }
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  runPostgresQuery(chart) {
    return this.connection.findById(chart.connection_id)
      .then((connection) => {
        return externalDbConnection(connection);
      })
      .then((db) => {
        return db.query(chart.query, { type: Sequelize.QueryTypes.SELECT });
      })
      .then((results) => {
        return this.getChartData(chart.id, results);
      })
      .then(() => {
        return this.findById(chart.id);
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  runRequest(chart) {
    return this.apiRequestController.sendRequest(chart.id, chart.connection_id)
      .then((data) => {
        return this.getChartData(chart.id, data);
      })
      .then(() => {
        return this.findById(chart.id);
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  runQuery(id) {
    let gChart;
    return this.findById(id)
      .then((chart) => {
        gChart = chart;
        return this.connection.getConnectionUrl(chart.connection_id);
      })
      .then((url) => {
        const options = {
          keepAlive: 1,
          connectTimeoutMS: 30000,
        };
        return mongoose.connect(url, options);
      })
      .then(() => {
        return Function(`'use strict';return (mongoose) => mongoose.${gChart.query}.toArray()`)()(mongoose); // eslint-disable-line
      })
      // if array fails, check if it works with object (for example .findOne() return object)
      .catch(() => {
        return Function(`'use strict';return (mongoose) => mongoose.${gChart.query}`)()(mongoose); // eslint-disable-line
      })
      .then((data) => {
        return this.getChartData(gChart.getDataValue("id"), data);
      })
      .then(() => {
        return this.findById(gChart.getDataValue("id"));
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  testMongoQuery({ connection_id, query }) {
    return this.connection.getConnectionUrl(connection_id)
      .then((url) => {
        const options = {
          keepAlive: 1,
          connectTimeoutMS: 30000,
        };
        return mongoose.connect(url, options);
      })
      .then(() => {
        return Function(`'use strict';return (mongoose) => mongoose.${query}.toArray()`)()(mongoose); // eslint-disable-line
      })
      .then((data) => {
        return new Promise(resolve => resolve(data));
      })
      .catch(() => {
        return Function(`'use strict';return (mongoose) => mongoose.${query}`)()(mongoose); // eslint-disable-line
      })
      .then((data) => {
        return new Promise(resolve => resolve(data));
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  testQuery(chart, projectId) {
    return this.connection.findById(chart.connection_id)
      .then((connection) => {
        if (connection.type === "mongodb") {
          return this.testMongoQuery(chart, projectId);
        } else if (connection.type === "postgres" || connection.type === "mysql") {
          return this.getPostgresData(chart, projectId, connection);
        } else {
          throw new Error("The connection type is not supported");
        }
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  getApiChartData(chart) {
    return this.connection.testApiRequest(chart.connection_id, chart.apiRequest)
      .then((data) => {
        return new Promise(resolve => resolve(data));
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  getPostgresData(chart, projectId, connection) {
    return externalDbConnection(connection)
      .then((db) => {
        return db.query(chart.query, { type: Sequelize.QueryTypes.SELECT });
      })
      .then((results) => {
        return new Promise(resolve => resolve(results));
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  getPreviewData(chart, projectId) {
    return this.connection.findById(chart.connection_id)
      .then((connection) => {
        if (connection.type === "mongodb") {
          return this.testQuery(chart, projectId);
        } else if (connection.type === "api") {
          return this.getApiChartData(chart, projectId);
        } else if (connection.type === "postgres" || connection.type === "mysql") {
          return this.getPostgresData(chart, projectId, connection);
        } else {
          throw new Error("The connection type is not supported");
        }
      })
      .catch((error) => {
        return new Promise((resolve, reject) => reject(error));
      });
  }

  previewChart(chart, projectId) {
    return this.getPreviewData(chart, projectId)
      .then((data) => {
        // LINE CHART
        if (chart.type === "line") {
          const lineChart = new LineChart(chart, data);
          return lineChart.aggregateOverTime();

        // BAR CHART
        } else if (chart.type === "bar") {
          const barChart = new BarChart(chart, data);

          if (chart.subType.toLowerCase().indexOf("timeseries") > -1) {
            return barChart.aggregateOverTime();
          } else if (chart.subType === "pattern") {
            return barChart.createPatterns();
          } else {
            return new Promise((resolve, reject) => reject(new Error("Could not find the chart type")));
          }

        // PIE CHART
        } else if (chart.type === "pie" || chart.type === "doughnut"
          || chart.type === "radar" || chart.type === "polar") {
          const pieChart = new PieChart(chart, data);
          if (chart.subType === "pattern") {
            return pieChart.createPatterns();
          } else {
            return new Promise((resolve, reject) => reject(new Error("Could not find the chart type")));
          }
        } else {
          return new Promise((resolve, reject) => reject(new Error("Could not find the chart type")));
        }
      })
      .then((chartData) => {
        return new Promise(resolve => resolve(chartData));
      })
      .catch((error) => {
        console.log("error", error);
        return new Promise((resolve, reject) => reject(error));
      });
  }

  getChartData(id, data) {
    let gChartData;
    return this.findById(id)
      .then((chart) => {
        // LINE CHART
        if (chart.type === "line") {
          const lineChart = new LineChart(chart, data);
          return lineChart.aggregateOverTime();

        // BAR CHART
        } else if (chart.type === "bar") {
          const barChart = new BarChart(chart, data);
          if (chart.subType.toLowerCase().indexOf("timeseries") > -1) {
            return barChart.aggregateOverTime();
          } else if (chart.subType === "pattern") {
            return barChart.createPatterns();
          } else {
            return new Promise((resolve, reject) => reject(new Error("Could not find the chart type")));
          }

        // PIE CHART
        } else if (chart.type === "pie" || chart.type === "doughnut"
          || chart.type === "radar" || chart.type === "polar") {
          const pieChart = new PieChart(chart, data);
          if (chart.subType === "pattern") {
            return pieChart.createPatterns();
          } else {
            return new Promise((resolve, reject) => reject(new Error("Could not find the chart type")));
          }
        } else {
          return new Promise((resolve, reject) => reject(new Error("Could not find the chart type")));
        }
      })
      .then((chartData) => {
        gChartData = chartData;
        return this.update(id, { chartData: gChartData, chartDataUpdated: moment() });
      })
      .then(() => {
        return new Promise(resolve => resolve(gChartData));
      });
  }
}

module.exports = ChartController;
